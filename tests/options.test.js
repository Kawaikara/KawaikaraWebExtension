const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { provider } = require('./helpers.cjs');
async function fixture(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://extension.test/options.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    calls = [];
  const state = {
    uiVersion: 1,
    loaded: true,
    loadError: '',
    connected: true,
    online: true,
    desktopAvailable: true,
    launchUrl: null,
    error: '',
    providers: [provider],
    active: [provider],
    configured: [{ ...provider, values: { menus: true } }],
    revision: 'a'.repeat(64),
    desktop: {
      name: 'Kawaikara Dev',
      version: '3.0.0',
      channel: 'nightly',
      runtime: 'development',
      appPath: '/apps/Kawaikara',
      profileId: 'abcdef123456',
    },
    bridgeUrl: 'http://127.0.0.1:12345',
    ...overrides,
  };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.chrome = {
    i18n: {
      getMessage: (key) => require('../_locales/en/messages.json')[key]?.message || '',
      getUILanguage: () => 'en',
    },
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      sendMessage: async (message) => {
        calls.push(message);
        if (message.type === 'configure') {
          for (const c of message.changes) {
            state.configured = state.configured.filter((p) => p.id !== c.providerId);
            if (c.enabled)
              state.configured.push({
                ...state.providers.find((p) => p.id === c.providerId),
                values: c.settings,
              });
          }
        }
        if (message.type === 'development-mode') state.developmentConnection = message.enabled;
        if (message.type === 'settings-update') state.configured[0].values = message.settings;
        if (message.type === 'revoke') state.configured = [];
        if (message.type === 'disconnect') {
          state.connected = false;
          state.online = false;
          state.providers = [];
          state.configured = [];
        }
        return { result: structuredClone(state) };
      },
    },
    permissions: { request: async () => true },
  };
  w.eval(fs.readFileSync('dist/chrome/options.js', 'utf8'));
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
  };
  await settle();
  return { w, state, calls, settle, document: w.document };
}
test('connected UI shows disconnect only, permission tags, app details and accessible status', async (t) => {
  const f = await fixture(t),
    d = f.document;
  assert.ok(d.querySelector('#disconnect'));
  assert.equal(d.querySelector('#connect'), null);
  assert.match(d.querySelector('[role=status]').textContent, /Connected/);
  assert.match(d.querySelector('.tags').textContent, /video.example/);
  [...d.querySelectorAll('button')].find((b) => b.textContent === 'Connected app details').click();
  assert.equal(d.querySelector('dialog[aria-labelledby=desktop-title]').open, true);
  assert.match(
    d.querySelector('dialog[aria-labelledby=desktop-title]').textContent,
    /abcdef123456/,
  );
  assert.doesNotMatch(
    d.querySelector('dialog[aria-labelledby=desktop-title]').textContent,
    /Bearer|token/,
  );
  d.querySelector('#disconnect').click();
  await f.settle();
  assert.ok(d.querySelector('#connect'));
  assert.equal(d.querySelector('#disconnect'), null);
});
test('Provider search filters by domain and shows an empty result', async (t) => {
  const f = await fixture(t);
  const input = f.document.querySelector('#provider-search');
  const set = Object.getOwnPropertyDescriptor(f.w.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'not-found');
  input.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await f.settle();
  assert.equal(f.document.querySelectorAll('.provider-card').length, 0);
  assert.match(f.document.body.textContent, /No matching Providers/);
  set.call(input, 'video.example');
  input.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await f.settle();
  assert.equal(f.document.querySelectorAll('.provider-card').length, 1);
});
function click(f, label) {
  [...f.document.querySelectorAll('button')].find((b) => b.textContent === label).click();
}
test('settings stay drafted until Apply, and failed offline apply preserves the draft', async (t) => {
  const f = await fixture(t);
  f.document.querySelectorAll('input[type=checkbox]')[1].click();
  await f.settle();
  assert.equal(f.calls.filter((c) => c.type === 'configure').length, 0);
  click(f, 'Apply');
  await f.settle();
  assert.equal(f.calls.filter((c) => c.type === 'configure').length, 1);
  assert.equal(f.state.configured[0].values.menus, false);
  const g = await fixture(t, { online: false, desktopAvailable: false });
  g.document.querySelectorAll('input[type=checkbox]')[1].click();
  await g.settle();
  click(g, 'Apply');
  await g.settle();
  assert.equal(g.calls.filter((c) => c.type === 'configure').length, 0);
  assert.match(g.document.body.textContent, /pnpm dev/);
  assert.equal(g.document.querySelectorAll('input[type=checkbox]')[1].checked, false);
  click(g, 'Cancel');
  await g.settle();
  assert.equal(g.document.querySelectorAll('input[type=checkbox]')[1].checked, true);
});
test('stale response gives reload guidance and running development app focuses through wake', async (t) => {
  const f = await fixture(t, { uiVersion: undefined, configured: undefined });
  assert.match(f.document.body.textContent, /Reload the extension/);
  const g = await fixture(t);
  g.document.querySelector('#launch').click();
  await g.settle();
  assert.ok(g.calls.some((c) => c.type === 'wake'));
});

test('bulk changes request site permissions once and send one batch only after Apply', async (t) => {
  const second = { ...provider, id: 'second.provider', domains: ['second.example'] };
  const f = await fixture(t, { providers: [provider, second], configured: [], active: [] });
  const permissions = [];
  f.w.chrome.permissions.request = async (value) => {
    permissions.push(value);
    return true;
  };
  click(f, 'Enable all Providers');
  await f.settle();
  assert.equal(permissions.length, 0);
  click(f, 'Apply');
  await f.settle();
  assert.equal(permissions.length, 1);
  const requests = f.calls.filter((c) => c.type === 'configure');
  assert.equal(requests.length, 1);
  assert.deepEqual(
    Array.from(requests[0].changes, (c) => c.providerId),
    [provider.id, second.id],
  );
  click(f, 'Disable all Providers');
  await f.settle();
  click(f, 'Cancel');
  await f.settle();
  assert.equal(f.calls.filter((c) => c.type === 'configure').length, 1);
});
test('denied browser permissions do not submit the batch and keep the draft', async (t) => {
  const f = await fixture(t, { configured: [], active: [] });
  f.w.chrome.permissions.request = async () => false;
  click(f, 'Enable all Providers');
  await f.settle();
  click(f, 'Apply');
  await f.settle();
  assert.equal(f.calls.filter((c) => c.type === 'configure').length, 0);
  assert.match(f.document.body.textContent, /Unsaved changes/);
});
test('development mode requires popup approval before persisting', async (t) => {
  const f = await fixture(t, { connected: false, configured: [], providers: [], active: [] });
  click(f, require('../_locales/en/messages.json').advancedConnection.message);
  await f.settle();
  f.document.querySelector('input[type=checkbox]').click();
  await f.settle();
  assert.equal(f.document.querySelector('#dev-mode-title').parentElement.open, true);
  assert.equal(f.calls.filter((c) => c.type === 'development-mode').length, 0);
  const dialog = f.document.querySelector('#dev-mode-title').parentElement;
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Enable').click();
  await f.settle();
  assert.equal(f.calls.find((c) => c.type === 'development-mode').enabled, true);
});

test('compact cards retain staged settings and open the full Provider editor', async (t) => {
  const f = await fixture(t, {
    providers: [{ ...provider, icon: 'https://video.example/icon.png' }],
  });
  const d = f.document;
  d.querySelector('[aria-label="Compact cards"]').click();
  await f.settle();
  assert.equal(f.w.localStorage.getItem('providerView'), 'compact');
  assert.equal(d.querySelectorAll('#providers .provider-settings').length, 0);
  assert.equal(d.querySelector('.provider-icon').getAttribute('referrerpolicy'), 'no-referrer');
  d.querySelector('.provider-card-open').click();
  await f.settle();
  assert.equal(d.querySelector('.provider-dialog').open, true);
  assert.ok(d.querySelector('.provider-dialog .provider-settings'));
  d.querySelector('.provider-dialog [role="switch"]').click();
  await f.settle();
  assert.ok(d.querySelector('.draft-footer'));
  assert.equal(f.calls.filter((c) => c.type === 'configure').length, 0);
  d.querySelector('[aria-label="Expanded panels"]').click();
  await f.settle();
  assert.equal(d.querySelector('#providers [role="switch"]').checked, false);
});

test('saved connection is shown as unverified while the app is unreachable', async (t) => {
  const f = await fixture(t, { online: false, desktopAvailable: false });
  const status = () => f.document.querySelector('[role=status]').textContent;
  assert.match(status(), /App not responding · Awaiting connection verification/);
  assert.match(
    f.document.querySelector('.connection-panel').textContent,
    /may have disconnected this extension/,
  );
  assert.ok(f.document.querySelector('#disconnect'));
  f.state.online = true;
  f.document.querySelector('#refresh').click();
  await f.settle();
  assert.match(status(), /Connected/);
  assert.doesNotMatch(status(), /Awaiting/);
  f.state.connected = false;
  f.state.online = false;
  f.state.disconnectedByApp = true;
  f.document.querySelector('#refresh').click();
  await f.settle();
  assert.match(status(), /Not connected/);
  assert.equal(f.document.querySelector('#launch'), null);
});
