const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogContext, provider } = require('./helpers.cjs');
const c = catalogContext().KawaikaraContract;
test('shared contract accepts arbitrary action IDs, settings and multiple DOM recipes', () => {
  c.validateWebExtensionProviders([provider]);
  c.validateWebExtensionProviders([
    {
      ...provider,
      domActions: [
        ...provider.domActions,
        { ...provider.domActions[0], id: 'card', event: 'click', requireVideo: false },
      ],
    },
  ]);
});
test('unknown executable fields, undeclared commands and settings are rejected', () => {
  for (const p of [
    { ...provider, code: 'alert(1)' },
    { ...provider, domains: ['*'] },
    { ...provider, contextMenus: [{ ...provider.contextMenus[0], action: 'unknown' }] },
    { ...provider, contextMenus: [{ ...provider.contextMenus[0], when: 'unknown' }] },
  ])
    assert.throws(() => c.validateWebExtensionProviders([p]));
  assert.throws(() => c.validateWebExtensionProviders([provider, provider]));
});
test('host matching remains scoped and presentation does not change authority', () => {
  assert.equal(
    c.resolveWebExtensionProvider([provider], 'https://video.example/watch')?.id,
    provider.id,
  );
  for (const url of [
    'https://video.example.evil.test/',
    'file:///tmp/test',
    'https://user:pass@video.example/',
    'https://video.example:444/',
  ])
    assert.equal(c.resolveWebExtensionProvider([provider], url), undefined);
  assert.equal(
    c.webExtensionPermissionKey(provider),
    c.webExtensionPermissionKey({ ...provider, contextMenus: [] }),
  );
  assert.notEqual(
    c.webExtensionPermissionKey(provider),
    c.webExtensionPermissionKey({
      ...provider,
      actionDefinitions: {
        ...provider.actionDefinitions,
        bookmark: { ...provider.actionDefinitions.bookmark, clipboard: true },
      },
    }),
  );
});
test('Provider images are display-only and reject non-image executable URLs', () => {
  for (const icon of ['https://video.example/icon.png', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E']) {
    c.validateWebExtensionProviders([{ ...provider, icon }]);
    assert.equal(
      c.webExtensionPermissionKey(provider),
      c.webExtensionPermissionKey({ ...provider, icon }),
    );
  }
  for (const icon of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/icon.png'])
    assert.throws(() => c.validateWebExtensionProviders([{ ...provider, icon }]));
});

test('action results cannot become an executable browser command channel', () => {
  c.validateWebExtensionBrowserResult({ ok: true }, false);
  c.validateWebExtensionBrowserResult({ ok: true, clipboard: 'approved text' }, true);
  for (const value of [
    null,
    [],
    { ok: false },
    { ok: true, script: 'alert(1)' },
    { ok: true, html: '<button>run</button>' },
    { ok: true, url: 'https://other.example' },
    { ok: true, commands: [] },
    { ok: true, clipboard: 'x'.repeat(16385) },
  ])
    assert.throws(() => c.validateWebExtensionBrowserResult(value, true));
  assert.throws(() =>
    c.validateWebExtensionBrowserResult({ ok: true, clipboard: 'not approved' }, false),
  );
});

test('locale resources support exact, base-language and fallback labels for every browser label', () => {
  const localized = {
    title: 'Open',
    translations: { 'en-US': 'Open', 'ko-KR': '열기', 'ja-JP': '開く' },
  };
  assert.equal(c.webExtensionItemTitle(localized, 'ko'), '열기');
  assert.equal(c.webExtensionItemTitle(localized, 'ko-KR'), '열기');
  assert.equal(c.webExtensionItemTitle(localized, 'ja'), '開く');
  assert.equal(c.webExtensionItemTitle(localized, 'fr'), 'Open');
  const catalog = structuredClone(provider);
  const action = catalog.actions[0];
  catalog.actionDefinitions[action] = { ...catalog.actionDefinitions[action], ...localized };
  catalog.settings[0] = { ...catalog.settings[0], ...localized };
  c.validateWebExtensionProviders([catalog]);
  catalog.settings[0].translations = { ko: { code: 'bad' } };
  assert.throws(() => c.validateWebExtensionProviders([catalog]), /translations/);
});
