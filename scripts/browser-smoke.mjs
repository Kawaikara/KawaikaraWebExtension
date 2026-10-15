// Uses an isolated Chrome-for-Testing profile; never touches the user's browser profile.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.resolve(process.argv[2] || path.join(root, '../kawaikara/dev3'));
const require = createRequire(path.join(desktop, 'package.json'));
const { chromium } = require('patchright');
const { buildSync } = require('esbuild');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'kawaikara-browser-test-'));
const moduleFile = path.join(temporary, 'bridge.cjs');
buildSync({
  entryPoints: [path.join(desktop, 'src/Main/Functional/ExternalApps/WebExtensionBridge.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: moduleFile,
});
const { WebExtensionBridge } = require(moduleFile);
const localeModule = path.join(temporary, 'provider-locale.cjs');
buildSync({
  entryPoints: [path.join(desktop, 'src/Main/Functional/Bundle/Provider/ProviderLocale.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: localeModule,
});
const { resolveProviderLocaleDescriptors } = require(localeModule);
const provider = async (name) => {
  const manifest = JSON.parse(
    await readFile(
      path.join(desktop, 'packages/builtin-sites/src/Providers', name, 'manifest.json'),
      'utf8',
    ),
  );
  const localization = JSON.parse(
    await readFile(
      path.join(
        desktop,
        'packages/builtin-sites/src/Providers',
        name,
        manifest.descriptors.locale.resource,
      ),
      'utf8',
    ),
  );
  const metadata = resolveProviderLocaleDescriptors(
    manifest.descriptors,
    localization,
    manifest.id,
  );
  return {
    ...metadata.webExtension,
    id: manifest.id,
    title: manifest.name,
    domains: manifest.descriptors.address.hosts,
  };
};
let providers = [await provider('YouTube'), await provider('Chzzk')];
const executed = [];
const bridge = new WebExtensionBridge({
  statePath: path.join(temporary, 'bridge.json'),
  providers: () => providers,
  execute: async (...args) => {
    executed.push(args);
    if (args[1] === 'copy-link') return { clipboard: 'https://example.test/shared' };
  },
  confirm: async () => true,
});
let browser;
try {
  await bridge.start();

  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'dist/chrome'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Permission prompts belong to browser chrome. Pregrant only fixture hosts in this isolated copy.
  // Never pregrant wildcard schemes: that masks mismatches with the shipped manifest.
  manifest.host_permissions.push(
    ...['youtube.com', 'youtu.be', 'chzzk.naver.com'].flatMap((host) => [
      `http://*.${host}/*`,
      `https://*.${host}/*`,
    ]),
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  browser.setDefaultTimeout(15000);
  console.log('Smoke: browser started');
  const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const settings = await browser.newPage();
  settings.on('pageerror', (error) => console.error('Settings error:', error));
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.waitForFunction(() =>
    document.querySelector('#load-status').textContent.includes('loaded'),
  );
  assert.equal(
    await settings.locator('article').count(),
    0,
    'Disconnected adapter has no built-in Providers',
  );
  await settings.locator('#connect').click();
  console.log('Smoke: connecting');
  await settings.waitForFunction(
    () =>
      document.querySelector('#providers').children.length === 2 ||
      (!document.querySelector('#connect').disabled &&
        document.querySelector('#status').textContent.includes('Multiple Kawaikara')),
  );
  if ((await settings.locator('article').count()) === 0) {
    // A real desktop may already own another discovery port. Pair only our
    // isolated bridge rather than prompting or changing the user's application.
    await settings.locator('#manual-label').click();
    await settings.locator('#code').fill(await bridge.createConnectionCode());
    await settings.locator('#connect-code').click();
    await settings.waitForFunction(
      () => document.querySelector('#providers').children.length === 2,
    );
    console.log('Smoke: multiple desktops detected; paired the isolated test bridge');
  }
  console.log('Smoke: connected');
  for (const title of ['YouTube', 'CHZZK']) {
    const card = settings
      .locator('article')
      .filter({ has: settings.getByRole('heading', { name: title, exact: true }) });
    // Disabled Providers still allow editing settings before opting in.
    await card.getByLabel('Player context menu', { exact: true }).uncheck();
    await card.getByRole('switch').check();
    await settings.waitForTimeout(500);
    assert.equal(await card.getByLabel('Player context menu', { exact: true }).isChecked(), false);
    await card.getByLabel('Player context menu', { exact: true }).check();
    await settings.waitForTimeout(300);
  }
  console.log('Smoke: Providers enabled');
  const session = await browser.newCDPSession(settings);
  // remove() uses the same manifest membership validation as request(), without
  // opening a permission prompt or granting access to this unvisited test host.
  const permissionCheck = async (origins) =>
    (
      await session.send('Runtime.evaluate', {
        expression: `chrome.permissions.remove({origins:${JSON.stringify(origins)}}).then(value => ({value}), error => ({error:error.message}))`,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  assert.match(
    (await permissionCheck(['*://*.thirdparty.example/*'])).error,
    /Only permissions specified in the manifest/,
  );
  assert.equal(
    (await permissionCheck(['http://*.thirdparty.example/*', 'https://*.thirdparty.example/*']))
      .error,
    undefined,
  );
  console.log(
    'Smoke: Chrome manifest validation rejects wildcard schemes and accepts explicit schemes',
  );
  const readState = async () =>
    (
      await session.send('Runtime.evaluate', {
        expression: `chrome.runtime.sendMessage({ type: 'settings' })`,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  const state = await readState();
  assert.equal(state.result.active.length, 2, JSON.stringify(state));
  assert.equal(state.result.active[0].actions.length, 3);
  await browser.route('https://www.youtube.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>document.addEventListener("contextmenu",event=>event.preventDefault())</script><div id="movie_player"><video style="width:500px;height:300px;background:#333"></video></div><div class="ytp-contextmenu"><div class="ytp-panel-menu"></div></div>`,
    }),
  );
  await browser.route('https://chzzk.naver.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>document.addEventListener("contextmenu",event=>event.preventDefault())</script><div class="pzp-pc"><video style="width:500px;height:300px;background:#333"></video></div><div class="pzp-contextmenu-pane"><ul class="pzp-contextmenu-pane__list"></ul></div>`,
    }),
  );
  for (const url of [
    'https://www.youtube.com/watch?v=fixture',
    'https://chzzk.naver.com/live/fixture',
  ]) {
    const page = await browser.newPage();
    await page.goto(url);
    console.log('Smoke: page loaded', url);
    await page.waitForTimeout(500);
    await page.locator('video').click({ button: 'right' });
    await page.locator('[data-kawaikara-provider]').first().waitFor();
    const initialItem = await page.locator('[data-kawaikara-provider]').first().elementHandle();
    await page.waitForTimeout(150);
    assert.equal(
      await initialItem.evaluate((node) => node.isConnected),
      true,
      'Injection retries preserve existing menu nodes and focus',
    );
    assert.equal(await page.locator('[data-kawaikara-provider]').count(), 3);
    const before = executed.length;
    await page
      .locator('[data-kawaikara-provider]')
      .first()
      .evaluate((node) => (node.querySelector('button') || node).click());
    await page.waitForTimeout(100);
    assert.equal(executed.length, before, 'Synthetic clicks must not dispatch');
    const actionNode = (index) =>
      url.includes('chzzk')
        ? page.locator('[data-kawaikara-provider]').nth(index).locator('button')
        : page.locator('[data-kawaikara-provider]').nth(index);
    await actionNode(1).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-kawaikara-provider]')].some((node) =>
        node.textContent.includes('copied'),
      ),
    );
    console.log('Smoke: copied', url);
    const afterCopy = executed.length;
    if (url.includes('youtube')) await actionNode(0).press('Enter');
    else await actionNode(0).click();
    for (let attempt = 0; executed.length === afterCopy && attempt < 100; attempt++)
      await page.waitForTimeout(50);
    assert.equal(
      executed.length,
      afterCopy + 1,
      await page
        .locator('html')
        .evaluate((node) => JSON.stringify({ data: node.dataset, body: document.body.innerHTML })),
    );
    assert.equal(executed.at(-1)[1], 'open');
    assert.equal(executed.at(-1)[2], url);
    await page.locator('video').click({ button: 'right' });
    await page.waitForTimeout(150);
    await actionNode(2).click();
    for (let attempt = 0; executed.at(-1)[1] !== 'download' && attempt < 100; attempt++)
      await page.waitForTimeout(50);
    assert.equal(executed.at(-1)[1], 'download');
    const providerId = executed.at(-1)[0];
    const recipe = providers.find((entry) => entry.id === providerId).domActions[0];
    await page.locator(recipe.target).evaluate((node) => {
      node.classList.add('fixture-updated');
      const existing = document.createElement('div');
      existing.id = 'existing-item';
      node.append(existing);
    });
    providers = providers.map((entry) =>
      entry.id === providerId
        ? {
            ...entry,
            domActions: [
              {
                ...entry.domActions[0],
                target: `${recipe.target}.fixture-updated`,
                placement: 'append',
                items: [...recipe.items]
                  .reverse()
                  .map((item) => ({ ...item, title: `Custom ${item.action}`, translations: {} })),
              },
            ],
          }
        : entry,
    );
    await bridge.invalidateCatalog();
    const updated = await readState();
    assert.ok(
      updated.result.active.some((entry) => entry.id === providerId),
      'Selector-only changes retain consent',
    );
    await page.locator('video').click({ button: 'right' });
    await page.waitForTimeout(150);
    await page.locator('[data-kawaikara-provider]').first().waitFor();
    assert.equal(await page.locator('[data-kawaikara-provider]').count(), 3);
    assert.ok(
      (await page.locator('[data-kawaikara-provider]').first().textContent()).includes(
        'Custom download',
      ),
    );
    assert.equal(
      await page.locator(recipe.target).evaluate((node) => node.firstElementChild.id),
      'existing-item',
    );
    // Provider-defined settings turn DOM descriptors off without disabling the Provider.
    const card = settings.locator('article').filter({
      has: settings.getByRole('heading', {
        name: providerId.includes('youtube') ? 'YouTube' : 'CHZZK',
        exact: true,
      }),
    });
    await settings.locator('#refresh').click();
    await card.getByLabel('Player context menu', { exact: true }).uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-kawaikara-provider]'));
    await page.locator('video').click({ button: 'right' });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[data-kawaikara-provider]').count(), 0);
    await card.getByLabel('Player context menu', { exact: true }).check();
    await card.getByRole('switch').waitFor({ state: 'visible' });
    await settings.waitForFunction(
      (id) => {
        const card = [...document.querySelectorAll('article')].find(
          (card) => card.querySelector('h2')?.textContent === id,
        );
        return card && !card.querySelector('input[role=switch]').disabled;
      },
      providerId.includes('youtube') ? 'YouTube' : 'CHZZK',
    );
    await page.locator('video').click({ button: 'right' });
    try {
      await page.locator('[data-kawaikara-provider]').first().waitFor();
    } catch (error) {
      console.error(
        'Restoration failure',
        JSON.stringify({
          url,
          status: await settings.locator('#status').innerText(),
          dom: await page.locator('body').innerHTML(),
        }),
      );
      throw error;
    }
    // A live declaration removal must clean up already injected UI, not only future documents.
    providers = providers.filter((entry) => entry.id !== executed.at(-1)[0]);
    await bridge.invalidateCatalog();
    await readState();
    await page.waitForFunction(() => !document.querySelector('[data-kawaikara-provider]'));
    await page.close();
  }
  console.log(
    'Chrome adapter smoke passed: empty disconnected catalog, code-free discovery and connection, editable disabled-Provider settings, Provider toggles, YouTube/CHZZK DOM recipes, dynamic settings, clipboard effects, actions, synthetic rejection, updates and removal.',
  );
} finally {
  await browser?.close();
  await bridge.dispose();
  await rm(temporary, { recursive: true, force: true });
}
