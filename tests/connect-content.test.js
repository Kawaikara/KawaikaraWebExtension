const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
async function run({
  url = 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64),
  child = false,
  development = false,
  mode = development,
  error,
} = {}) {
  const status = { dataset: {} },
    calls = [],
    history = [];
  const window = {};
  window.top = child ? {} : window;
  const context = vm.createContext({
    window,
    location: { href: url },
    document: { getElementById: () => status },
    history: { replaceState: (...args) => history.push(args) },
    chrome: {
      i18n: {
        getMessage: (key) => require('../_locales/ko/messages.json')[key]?.message || '',
        getUILanguage: () => 'ko',
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === 'desktop-connect-mode')
            return { result: { developmentConnection: mode } };
          calls.push(message);
          return error ? { error } : { result: { connected: true } };
        },
      },
    },
  });
  vm.runInContext(
    development
      ? require('esbuild').buildSync({
          entryPoints: [require.resolve('../src/connect-content.ts')],
          bundle: true,
          write: false,
          define: { __KAWAIKARA_DEVELOPMENT__: 'true' },
        }).outputFiles[0].text
      : fs.readFileSync(require.resolve('../dist/chrome/connect-content.js'), 'utf8'),
    context,
  );
  await new Promise(setImmediate);
  return { status, calls, history };
}
test('onboarding signals worker without forwarding secrets and removes fragment after completion', async () => {
  const f = await run();
  assert.equal(JSON.stringify(f.calls), '[{"type":"desktop-connect"}]');
  assert.match(f.status.textContent, /연결 완료/);
  assert.equal(f.history[0][2], '/extension-connect');
});
test('failed onboarding reports retry; other pages and embedded frames cannot initiate pairing', async () => {
  const f = await run({ error: 'expired' });
  assert.match(f.status.textContent, /다시 눌러/);
  assert.equal(f.history.length, 1);
  assert.equal((await run({ child: true })).calls.length, 0);
  assert.equal(
    (await run({ url: 'https://example.com/extension-connect#' + 'a'.repeat(64) })).calls.length,
    0,
  );
});

test('production content script leaves development onboarding entirely untouched', async () => {
  const f = await run({
    url: 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64) + ':development',
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.history.length, 0);
  assert.equal(f.status.dataset.adapter, undefined);
  const normal = await run({
    url: 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64) + ':production',
  });
  assert.equal(normal.calls.length, 1);
});

test('development adapter pairs only on the development handoff page', async () => {
  const prefix = 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64);
  const normal = await run({ development: true, url: prefix + ':production' });
  assert.equal(normal.calls.length, 0);
  assert.equal(normal.history.length, 0);
  const dev = await run({ development: true, url: prefix + ':development' });
  assert.equal(dev.calls.length, 1);
});

test('regular build honors explicit development mode without changing its build identity', async () => {
  const f = await run({
    mode: true,
    url: 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64) + ':development',
  });
  assert.equal(f.calls.length, 1);
  const normal = await run({
    mode: true,
    url: 'http://127.0.0.1:12345/extension-connect#' + 'a'.repeat(64) + ':production',
  });
  assert.equal(normal.calls.length, 0);
});
