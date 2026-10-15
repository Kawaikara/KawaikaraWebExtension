const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { catalogContext, provider } = require('./helpers.cjs');
async function fixture({
  launchUrl = 'kawaikara://bridge/wake',
  paired = true,
  online = true,
  approved = true,
  descriptors = [provider],
  menuFailure = false,
  discoveries = 1,
  developmentApp = false,
  storage,
} = {}) {
  const listeners = {},
    menus = [],
    scripts = [],
    copied = [],
    invoked = [],
    badges = [],
    settingsOpened = [];
  const context = catalogContext();
  const contract = context.KawaikaraContract;
  let catalog = structuredClone(descriptors),
    revision = 'a'.repeat(64);
  let grants = approved
    ? catalog.map((p) => ({
        id: p.id,
        key: contract.webExtensionPermissionKey(p),
        actions: p.actions,
        settings: contract.webExtensionSettings(p, {}),
      }))
    : [];
  let serverPort = 12345,
    forgedProof = false;
  const requests = [],
    opened = [],
    updated = [];
  let revoked = false,
    validRevocation = true;
  let tabUrl = 'https://video.example/watch/1';
  let documentKey = '11111111-1111-4111-8111-111111111111';
  const stored = storage || {
    localGrants: [{ id: 'legacy', actions: ['open'] }],
    ...(paired
      ? {
          connection: {
            version: 1,
            url: 'http://127.0.0.1:12345',
            token: 'a'.repeat(64),
            launchUrl: 'kawaikara://bridge/wake',
          },
        }
      : {}),
  };
  let serverToken =
    stored.connection?.token ?? stored.pendingDisconnects?.[0]?.token ?? 'a'.repeat(64);
  const event = (name) => ({
    addListener: (listener) => {
      listeners[name] = listener;
    },
  });
  const api = {
    runtime: {
      id: 'extension',
      getURL: (part) => `chrome-extension://extension/${part}`,
      onMessage: event('message'),
      onStartup: event('startup'),
      onInstalled: event('installed'),
      openOptionsPage: async () => {
        settingsOpened.push(true);
      },
    },
    i18n: {
      getMessage: (key) => require('../_locales/en/messages.json')[key]?.message || '',
      getUILanguage: () => 'en-US',
    },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => stored,
        set: async (next) => Object.assign(stored, next),
        remove: async (key) => {
          for (const item of Array.isArray(key) ? key : [key]) delete stored[item];
        },
      },
    },
    permissions: {
      contains: async () => true,
      onAdded: event('permissionAdded'),
      onRemoved: event('permissionRemoved'),
    },
    alarms: { create: async () => {}, onAlarm: event('alarm') },
    contextMenus: {
      removeAll: async () => {
        menus.length = 0;
      },
      create: (menu, callback) => {
        if (menuFailure) api.runtime.lastError = { message: 'Menu registration failed' };
        else menus.push(menu);
        callback();
        delete api.runtime.lastError;
      },
      onClicked: event('menu'),
    },
    scripting: {
      getRegisteredContentScripts: async () => scripts,
      unregisterContentScripts: async () => {
        scripts.length = 0;
      },
      registerContentScripts: async (next) => scripts.push(...next),
      executeScript: async (details) => copied.push(details),
    },
    tabs: {
      sendMessage: async () => ({ documentKey, url: tabUrl }),
      update: async (id, change) => {
        updated.push({ id, ...change });
        return { id, ...change };
      },
      create: async (tab) => {
        opened.push(tab);
        return { id: 2, ...tab };
      },
      query: async () => [],
      get: async () => ({ url: tabUrl }),
    },
    action: {
      onClicked: event('toolbar'),
      setBadgeText: async ({ text }) => badges.push(text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  };
  Object.assign(context, {
    chrome: api,
    crypto: require('node:crypto').webcrypto,
    TextEncoder,
    AbortSignal,
    Date,
    fetch: async (url, options) => {
      if (!online) throw new Error('Offline');
      requests.push({ url, authorization: options.headers.Authorization, body: options.body });
      if (revoked && ['/v1/catalog', '/v1/disconnect'].includes(new URL(url).pathname)) {
        const proof = validRevocation
          ? require('node:crypto')
              .createHmac('sha256', serverToken)
              .update(
                `revoked\n${options.headers['X-Kawaikara-Nonce']}\n${api.runtime.getURL('').replace(/\/$/, '')}`,
              )
              .digest('hex')
          : 'forged';
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: 'revoked', proof }),
        };
      }
      let data;
      if (new URL(url).pathname.endsWith('/discover')) {
        const index = contract.WEB_EXTENSION_DISCOVERY_PORTS.indexOf(+new URL(url).port);
        if (index >= discoveries) throw new Error('No listener');
        data = {
          protocol: 'kawaikara-web-extension',
          development: developmentApp,
          adapterVersion: 2,
          url: `http://127.0.0.1:${serverPort + index}`,
        };
        const nonce = new URL(url).searchParams.get('nonce');
        if (nonce)
          data.proof = forgedProof
            ? 'bad'
            : require('node:crypto')
                .createHmac('sha256', serverToken)
                .update(nonce + '\n' + data.url + '\n' + api.runtime.getURL('').replace(/\/$/, ''))
                .digest('hex');
      } else if (url.endsWith('/connect') || url.endsWith('/pair')) {
        serverToken = 'b'.repeat(64);
        data = { adapterVersion: 2, token: serverToken, launchUrl };
      } else if (url.endsWith('/catalog')) {
        if (+new URL(url).port !== serverPort) throw new Error('Old port');
        data = { version: 2, providers: catalog, grants, revision, launchUrl };
      } else {
        const body = JSON.parse(options.body);
        const p = catalog.find((p) => p.id === body.providerId);
        if (url.endsWith('/grant'))
          grants = [
            ...grants.filter((g) => g.id !== p.id),
            {
              id: p.id,
              key: contract.webExtensionPermissionKey(p),
              actions: p.actions,
              settings: contract.webExtensionSettings(p, body.settings),
            },
          ];
        if (url.endsWith('/revoke')) grants = grants.filter((g) => g.id !== body.providerId);
        if (url.endsWith('/settings'))
          grants.find((g) => g.id === body.providerId).settings = body.settings;
        if (url.endsWith('/invoke')) invoked.push(body);
        data = {
          ok: true,
          ...(body.action === 'share' ? { clipboard: 'https://thirdparty.example/share/123' } : {}),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    },
  });
  vm.runInContext(
    fs.readFileSync(require.resolve('../dist/chrome/background.js'), 'utf8'),
    context,
  );
  const optionsSender = { id: 'extension', url: api.runtime.getURL('options.html') };
  const contentSender = {
    id: 'extension',
    url: 'https://video.example/watch/1',
    frameId: 0,
    tab: { id: 1 },
  };
  const send = (data, sender = optionsSender) =>
    new Promise((resolve) => {
      if (!listeners.message(data, sender, resolve)) resolve(null);
    });
  await send({ type: 'settings' });
  return {
    send,
    revoke: (valid = true) => {
      revoked = true;
      validRevocation = valid;
    },
    opened,
    updated,
    replaceDocument: () => {
      documentKey = '22222222-2222-4222-8222-222222222222';
    },
    setTabUrl: (url) => {
      tabUrl = url;
    },
    online: () => {
      online = true;
    },
    menus,
    scripts,
    copied,
    invoked,
    badges,
    settingsOpened,
    contentSender,
    listeners,
    stored,
    requests,
    movePort: (port, forged = false) => {
      serverPort = port;
      forgedProof = forged;
    },
    update: (value) => {
      catalog = value;
      revision = 'b'.repeat(64);
    },
    offline: () => {
      online = false;
    },
  };
}
test('disconnected adapter has no Providers, menus, scripts, legacy grants or deep links', async () => {
  const f = await fixture({ paired: false });
  const s = (await f.send({ type: 'settings' })).result;
  assert.equal(s.loaded, true);
  assert.equal(s.providers.length, 0);
  assert.equal(f.menus.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.stored.localGrants, undefined);
  assert.equal(f.badges.at(-1), 'LINK');
  assert.ok((await f.send({ type: 'enable', providerId: provider.id })).error);
});
test('connected but disabled Provider publishes settings only; toggle applies the complete contract', async () => {
  const f = await fixture({ approved: false });
  let s = (await f.send({ type: 'settings' })).result;
  assert.equal(s.providers.length, 1);
  assert.equal(s.active.length, 0);
  assert.equal(f.menus.length, 0);
  s = (await f.send({ type: 'enable', providerId: provider.id })).result;
  assert.equal(s.active.length, 1);
  assert.equal(s.active[0].actions.length, 4);
  assert.equal(f.menus.length, 2);
  assert.equal(f.scripts.length, 1);
  await f.send({ type: 'revoke', providerId: provider.id });
  assert.equal(f.menus.length, 0);
  assert.equal(f.scripts.length, 0);
});
test('third-party action IDs and clipboard effects route through Kawaikara', async () => {
  const f = await fixture();
  const s = (await f.send({ type: 'provider-state' }, f.contentSender)).result;
  const r = await f.send(
    { type: 'provider-action', providerId: provider.id, action: 'bookmark', revision: s.revision },
    f.contentSender,
  );
  assert.equal(r.error, undefined);
  assert.equal(f.invoked[0].action, 'bookmark');
  f.listeners.toolbar({ id: 1, url: f.contentSender.url });
  await new Promise(setImmediate);
  assert.equal(f.invoked[1].action, 'share');
  assert.equal(f.copied[0].args[0], 'https://thirdparty.example/share/123');
});
test('Provider-defined settings dynamically hide its menu and survive refresh', async () => {
  const f = await fixture();
  const s = (
    await f.send({ type: 'settings-update', providerId: provider.id, settings: { menus: false } })
  ).result;
  assert.equal(s.active[0].values.menus, false);
  assert.equal(f.menus.length, 1);
  assert.equal(f.menus[0].title, 'Bookmark this link');
  assert.ok(
    (
      await f.send({
        type: 'settings-update',
        providerId: provider.id,
        settings: { unknown: true },
      })
    ).error,
  );
});
test('offline retains cached descriptors; disconnect removes them', async () => {
  const f = await fixture();
  f.offline();
  const s = (await f.send({ type: 'settings' })).result;
  assert.equal(s.connected, true);
  assert.equal(s.online, false);
  assert.equal(f.badges.at(-1), 'WAIT');
  assert.equal(s.providers.length, 1);
  assert.equal(s.configured.length, 1);
  assert.equal(s.active.length, 1);
  assert.equal(f.menus.length, 2);
  assert.equal(f.scripts.length, 1);
  await f.send({ type: 'disconnect' });
  assert.equal(f.stored.connection, undefined);
});
test('foreign senders, subframes and forged Provider claims fail closed', async () => {
  const f = await fixture();
  assert.equal(await f.send({ type: 'provider-state' }, { ...f.contentSender, id: 'other' }), null);
  assert.equal(await f.send({ type: 'provider-state' }, { ...f.contentSender, frameId: 1 }), null);
  assert.ok((await f.send({ type: 'enable', providerId: provider.id }, f.contentSender)).error);
  assert.ok(
    (
      await f.send(
        {
          type: 'provider-action',
          providerId: 'other',
          action: 'bookmark',
          revision: 'a'.repeat(64),
        },
        f.contentSender,
      )
    ).error,
  );
  assert.equal(f.invoked.length, 0);
});
test('uninstall and stale revisions remove authority and UI', async () => {
  const f = await fixture();
  f.update([]);
  await f.send({ type: 'settings' });
  assert.equal(f.menus.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.ok(
    (
      await f.send(
        {
          type: 'provider-action',
          providerId: provider.id,
          action: 'bookmark',
          revision: 'a'.repeat(64),
        },
        f.contentSender,
      )
    ).error,
  );
});
test('501 overlapping third-party Providers remain independent above the old byte ceiling', async () => {
  const providers = Array.from({ length: 501 }, (_, i) => ({
    ...provider,
    id: `thirdparty.${i}`,
    title: 'Third-party browser integration '.repeat(5),
  }));
  assert.ok(JSON.stringify(providers).length > 524288);
  const f = await fixture({ descriptors: providers });
  assert.equal(f.menus.length, 1002);
  f.listeners.menu(
    { menuItemId: JSON.stringify(['thirdparty.500', 'save-link']), linkUrl: f.contentSender.url },
    { id: 1 },
  );
  await new Promise(setImmediate);
  assert.equal(f.invoked[0].providerId, 'thirdparty.500');
});
test('registration errors are visible and never marked loaded', async () => {
  const f = await fixture({ menuFailure: true });
  assert.match((await f.send({ type: 'settings' })).error, /Menu registration failed/);
  assert.equal(f.badges.at(-1), '!');
});
test('distributed adapter contains no site catalogs or site-specific share/deep-link behavior', () => {
  for (const file of ['builtin-providers.js', 'supported-sites.js'])
    assert.equal(
      fs.existsSync(require('node:path').join(__dirname, '../dist/chrome', file)),
      false,
    );
  const background = fs.readFileSync(require.resolve('../dist/chrome/background.js'), 'utf8');
  for (const fragment of ['youtube.com', 'chzzk.naver.com', 'kawaikara.github.io'])
    assert.equal(background.includes(fragment), false);
});

test('code-free connection discovers the app and stores the approved credential', async () => {
  const f = await fixture({ paired: false, approved: false });
  const result = await f.send({ type: 'connect' });
  assert.equal(result.error, undefined);
  assert.equal(result.result.online, true);
  assert.equal(f.stored.connection.url, 'http://127.0.0.1:12345');
  assert.equal(f.stored.connection.token, 'b'.repeat(64));
  assert.equal(result.result.active.length, 0);
  assert.ok((await f.send({ type: 'connect' }, f.contentSender)).error);
});
test('automatic connection reports absent and ambiguous desktops without replacing credentials', async () => {
  const missing = await fixture({ paired: false, discoveries: 0 });
  assert.match((await missing.send({ type: 'connect' })).error, /Start or update/);
  assert.equal(missing.stored.connection, undefined);
  const ambiguous = await fixture({ paired: false, discoveries: 2 });
  assert.match((await ambiguous.send({ type: 'connect' })).error, /Multiple/);
  assert.equal(ambiguous.stored.connection, undefined);
  const existing = await fixture({ discoveries: 2 });
  assert.equal((await existing.send({ type: 'connect' })).error, undefined);
  assert.equal(existing.stored.connection.url, 'http://127.0.0.1:12345');
});
test('enabling applies drafted Provider settings and rejects undeclared settings', async () => {
  const f = await fixture({ approved: false });
  assert.ok(
    (await f.send({ type: 'enable', providerId: provider.id, settings: { injected: true } })).error,
  );
  const result = await f.send({
    type: 'enable',
    providerId: provider.id,
    settings: { menus: false },
  });
  assert.equal(result.result.active[0].values.menus, false);
  assert.equal(f.menus.length, 1);
});

test('port migration requires a proof before sending the saved credential', async () => {
  const f = await fixture();
  f.movePort(12346);
  const state = (await f.send({ type: 'settings' })).result;
  assert.equal(state.online, true);
  assert.equal(f.stored.connection.url, 'http://127.0.0.1:12346');
  assert.ok(f.requests.some((r) => r.url === 'http://127.0.0.1:12346/v1/catalog'));
  f.movePort(12347, true);
  assert.equal((await f.send({ type: 'settings' })).result.online, false);
  assert.equal(
    f.requests.some((r) => r.url === 'http://127.0.0.1:12347/v1/catalog'),
    false,
  );
});
test('cached descriptors survive worker restart offline but cannot authorize settings mutations', async () => {
  const first = await fixture();
  const f = await fixture({ storage: first.stored, online: false });
  const state = (await f.send({ type: 'settings' })).result;
  assert.equal(state.providers.length, 1);
  assert.equal(state.configured.length, 1);
  assert.equal(state.online, false);
  assert.equal(state.active.length, 1);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.menus.length, 2);
  assert.ok(
    (await f.send({ type: 'settings-update', providerId: provider.id, settings: { menus: false } }))
      .error,
  );
  assert.equal(f.stored.catalogCache.catalog.grants[0].settings.menus, true);
  await f.send({ type: 'disconnect' });
  assert.equal(f.stored.catalogCache, undefined);
});

async function queueAction(f) {
  const result = await f.send(
    {
      type: 'provider-action',
      providerId: provider.id,
      action: 'bookmark',
      revision: 'a'.repeat(64),
    },
    f.contentSender,
  );
  assert.equal(result.result.queued, true);
  assert.equal(f.invoked.length, 0);
  return { id: 'extension', url: f.opened[0].url, tab: { id: 2 } };
}
test('first pairing saves launcher; cached action wakes then dispatches exactly once after authenticated port migration', async () => {
  const f = await fixture({ paired: false });
  await f.send({ type: 'connect' });
  assert.equal(f.stored.connection.launchUrl, 'kawaikara://bridge/wake');
  f.offline();
  await f.send({ type: 'settings' });
  assert.equal(f.opened.length, 0);
  const sender = await queueAction(f);
  assert.equal(
    (await f.send({ type: 'launch-info' }, sender)).result.launchUrl,
    'kawaikara://bridge/wake',
  );
  assert.equal((await f.send({ type: 'launch-resume' }, sender)).result.waiting, true);
  f.online();
  f.movePort(12346);
  assert.equal((await f.send({ type: 'launch-resume' }, sender)).result.completed, true);
  assert.equal(f.invoked.length, 1);
  assert.equal(f.stored.connection.launchUrl, 'kawaikara://bridge/wake');
  assert.ok((await f.send({ type: 'launch-resume' }, sender)).error);
  assert.equal(f.invoked.length, 1);
});
test('cancelled, stale and unauthenticated wake requests cannot execute', async () => {
  const f = await fixture();
  f.offline();
  const sender = await queueAction(f);
  assert.ok((await f.send({ type: 'launch-resume' }, f.contentSender)).error);
  f.online();
  f.movePort(12346, true);
  assert.equal((await f.send({ type: 'launch-resume' }, sender)).result.waiting, true);
  assert.equal(f.invoked.length, 0);
  await f.send({ type: 'launch-cancel' }, sender);
  f.movePort(12346);
  assert.ok((await f.send({ type: 'launch-resume' }, sender)).error);
  const g = await fixture();
  g.offline();
  const next = await queueAction(g);
  g.update([]);
  g.online();
  assert.ok((await g.send({ type: 'launch-resume' }, next)).error);
  assert.equal(g.invoked.length, 0);
});
test('pending actions survive worker restart without automatically launching the app', async () => {
  const first = await fixture();
  first.offline();
  const sender = await queueAction(first);
  const resumed = await fixture({ storage: first.stored });
  assert.equal(resumed.opened.length, 0);
  assert.equal((await resumed.send({ type: 'launch-resume' }, sender)).result.completed, true);
  assert.equal(resumed.invoked.length, 1);
});

test('desktop onboarding takes its ticket only from the browser-supplied top-frame URL', async () => {
  const f = await fixture({ paired: false });
  const url = 'http://127.0.0.1:12345/extension-connect#' + 'c'.repeat(64);
  const sender = { id: 'extension', url, frameId: 0, tab: { id: 1 } };
  f.setTabUrl(url);
  assert.equal(await f.send({ type: 'desktop-connect' }, { ...sender, frameId: 1 }), null);
  assert.equal(await f.send({ type: 'desktop-connect', url }, f.contentSender), null);
  const result = await f.send({ type: 'desktop-connect', token: 'forged' }, sender);
  assert.equal(result.result.connected, true);
  assert.equal(f.stored.connection.launchUrl, 'kawaikara://bridge/wake');
  assert.equal(
    JSON.parse(f.requests.find((r) => r.url.endsWith('/connect')).body).handoff,
    'c'.repeat(64),
  );
  assert.equal(f.settingsOpened.length, 0);
  assert.equal(f.updated.length, 1);
  assert.equal(f.updated[0].id, 1);
  assert.match(f.updated[0].url, /options.html$/);
});
test('onboarding stops if the browser tab navigates before pairing', async () => {
  const f = await fixture({ paired: false });
  const result = await f.send(
    { type: 'desktop-connect' },
    {
      id: 'extension',
      frameId: 0,
      tab: { id: 1 },
      url: 'http://127.0.0.1:12345/extension-connect#' + 'c'.repeat(64),
    },
  );
  assert.match(result.error, /page changed/);
  assert.equal(
    f.requests.some((r) => r.url.endsWith('/connect')),
    false,
  );
});

test('development catalog clears obsolete launcher and running app accepts authenticated focus', async () => {
  const f = await fixture({ launchUrl: null });
  assert.equal(f.stored.connection.launchUrl, null);
  assert.equal((await f.send({ type: 'wake' })).error, undefined);
  assert.ok(f.requests.some((r) => r.url.endsWith('/wake')));
  assert.ok((await f.send({ type: 'wake' }, f.contentSender)).error);
  f.offline();
  const result = await f.send(
    {
      type: 'provider-action',
      providerId: provider.id,
      action: 'bookmark',
      revision: 'a'.repeat(64),
    },
    f.contentSender,
  );
  assert.match(result.error, /pnpm dev/);
  assert.equal(f.opened.length, 0);
});

test('SPA video navigation uses the current live document URL, not the initial sender URL', async () => {
  const f = await fixture();
  f.setTabUrl('https://video.example/watch/2');
  const message = {
    type: 'provider-action',
    providerId: provider.id,
    action: 'bookmark',
    revision: 'a'.repeat(64),
    documentKey: '11111111-1111-4111-8111-111111111111',
    url: 'https://video.example/watch/2',
  };
  assert.equal((await f.send(message, f.contentSender)).error, undefined);
  assert.equal(f.invoked[0].url, 'https://video.example/watch/2');
});
test('a replaced document, stale click URL, or cross-origin navigation cannot dispatch an action', async () => {
  const f = await fixture();
  const message = {
    type: 'provider-action',
    providerId: provider.id,
    action: 'bookmark',
    revision: 'a'.repeat(64),
    documentKey: '11111111-1111-4111-8111-111111111111',
    url: f.contentSender.url,
  };
  f.setTabUrl('https://video.example/watch/2');
  assert.match((await f.send(message, f.contentSender)).error, /Document navigated/);
  f.setTabUrl(message.url);
  f.replaceDocument();
  assert.match((await f.send(message, f.contentSender)).error, /Document navigated/);
  const g = await fixture();
  g.setTabUrl('https://evil.example/watch/1');
  assert.match(
    (await g.send({ ...message, url: 'https://evil.example/watch/1' }, g.contentSender)).error,
    /Document navigated/,
  );
  assert.equal(f.invoked.length + g.invoked.length, 0);
});

test('saved development mode drives discovery and survives worker restart', async () => {
  const f = await fixture({ paired: false, developmentApp: true });
  assert.ok((await f.send({ type: 'connect' })).error);
  const mode = await f.send({ type: 'development-mode', enabled: true });
  assert.equal(mode.result.developmentConnection, true);
  assert.equal(f.stored.developmentConnection, true);
  assert.equal((await f.send({ type: 'connect' })).result.connected, true);
  const restored = await fixture({ storage: f.stored, developmentApp: true });
  assert.equal((await restored.send({ type: 'settings' })).result.developmentConnection, true);
});
test('configure validates current revision and sends only one batch', async () => {
  const f = await fixture();
  const state = (await f.send({ type: 'settings' })).result;
  const changes = [{ providerId: provider.id, enabled: true, settings: { menus: true } }];
  assert.ok((await f.send({ type: 'configure', revision: 'stale', changes })).error);
  const before = f.requests.filter((r) => r.url.endsWith('/configure')).length;
  const result = await f.send({ type: 'configure', revision: state.revision, changes });
  assert.equal(result.error, undefined);
  assert.equal(f.requests.filter((r) => r.url.endsWith('/configure')).length, before + 1);
});

test('signed desktop revocation clears cached controls and launch authority, forged errors do not', async () => {
  const f = await fixture();
  f.revoke(false);
  const forged = (await f.send({ type: 'settings' })).result;
  assert.equal(forged.connected, true);
  assert.equal(forged.providers.length, 1);
  f.revoke(true);
  const revoked = (await f.send({ type: 'settings' })).result;
  assert.equal(revoked.connected, false);
  assert.equal(revoked.disconnectedByApp, true);
  assert.equal(revoked.launchUrl, undefined);
  assert.equal(revoked.providers.length, 0);
  assert.equal(f.menus.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.stored.connection, undefined);
  assert.equal(f.stored.catalogCache, undefined);
});
test('language selection persists and invalid locale cannot change settings', async () => {
  const f = await fixture({ paired: false });
  assert.equal((await f.send({ type: 'language', language: 'ko' })).result.language, 'ko');
  assert.equal(f.stored.language, 'ko');
  const next = await fixture({ paired: false, storage: f.stored });
  assert.equal((await next.send({ type: 'settings' })).result.language, 'ko');
  assert.ok((await next.send({ type: 'language', language: 'bogus' })).error);
  assert.equal(f.stored.language, 'ko');
});

test('language changes remain local when the desktop is offline', async () => {
  const f = await fixture();
  f.offline();
  const before = f.requests.length;
  const result = await f.send({ type: 'language', language: 'ja' });
  assert.equal(result.error, undefined);
  assert.equal(result.result.language, 'ja');
  assert.equal(f.stored.language, 'ja');
  assert.equal(f.requests.length, before);
});

test('offline disconnect persists intent, clears local access, and notifies the same app after worker restart and port migration', async () => {
  const f = await fixture();
  f.offline();
  const reply = await f.send({ type: 'disconnect' });
  assert.equal(reply.error, undefined);
  assert.equal(reply.result.connected, false);
  assert.equal(reply.result.pendingDisconnectCount, 1);
  assert.equal(f.menus.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.stored.connection, undefined);
  assert.equal(f.stored.catalogCache, undefined);
  const restarted = await fixture({ storage: f.stored, online: false });
  restarted.movePort(23456);
  restarted.online();
  const confirmed = await restarted.send({ type: 'settings' });
  assert.equal(confirmed.result.pendingDisconnectCount, 0);
  assert.equal(confirmed.result.connected, false);
  assert.ok(
    restarted.requests.some(
      (r) =>
        r.url === 'http://127.0.0.1:23456/v1/disconnect' &&
        r.authorization === 'Bearer ' + 'a'.repeat(64),
    ),
  );
  assert.equal(restarted.opened.length, 0);
});

test('pending disconnect never sends credentials to an unproven app', async () => {
  const f = await fixture();
  f.offline();
  await f.send({ type: 'disconnect' });
  f.movePort(23456, true);
  f.online();
  const result = await f.send({ type: 'settings' });
  assert.equal(result.result.pendingDisconnectCount, 1);
  assert.equal(f.requests.filter((r) => r.url.endsWith('/disconnect')).length, 0);
  assert.equal(f.stored.connection, undefined);
});

test('durable disconnect intent prevents stale active credentials being restored after an interrupted cleanup', async () => {
  const connection = { version: 1, url: 'http://127.0.0.1:12345', token: 'a'.repeat(64) };
  const f = await fixture({
    online: false,
    storage: { connection, pendingDisconnects: [connection] },
  });
  const result = await f.send({ type: 'settings' });
  assert.equal(result.result.connected, false);
  assert.equal(result.result.pendingDisconnectCount, 1);
  assert.equal(f.menus.length, 0);
});

test('signed already-revoked acknowledgement clears pending disconnect, forged acknowledgement does not', async () => {
  for (const valid of [false, true]) {
    const f = await fixture();
    f.offline();
    await f.send({ type: 'disconnect' });
    f.revoke(valid);
    f.online();
    const reply = await f.send({ type: 'settings' });
    assert.equal(reply.result.pendingDisconnectCount, valid ? 0 : 1);
    assert.equal(reply.result.connected, false);
  }
});
