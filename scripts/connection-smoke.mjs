// Isolated browser regression: never uses or changes the user's browser profile.
import { createRequire } from 'node:module';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const desktop = path.resolve(root, '../kawaikara/dev3');
const require = createRequire(path.join(desktop, 'package.json'));
const { chromium } = require('patchright');
const { buildSync } = require('esbuild');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'kawaikara-connection-'));
const bridgeModule = path.join(temporary, 'bridge.cjs');
buildSync({
  entryPoints: [path.join(desktop, 'src/Main/Functional/ExternalApps/WebExtensionBridge.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bridgeModule,
});
const { WebExtensionBridge } = require(bridgeModule);
const providers = [
  {
    version: 2,
    id: 'test.provider',
    title: 'Test Provider',
    icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22 fill=%22purple%22/%3E%3C/svg%3E',
    domains: ['example.com'],
    actions: ['open'],
    actionDefinitions: { open: { title: 'Open', handler: 'open' } },
    settings: [{ id: 'menu', title: 'Menu', defaultValue: true }],
    contextMenus: [{ id: 'open', title: 'Open', action: 'open', contexts: ['page'] }],
  },
];
const approvals = [];
const bridge = new WebExtensionBridge({
  statePath: path.join(temporary, 'state.json'),
  development: true,
  providers: () => providers,
  execute: async () => {},
  confirm: async (detail) => {
    approvals.push(detail);
    return true;
  },
  pageImage: () => readFile(path.join(desktop, 'imgs/kawaikara_banner2.png')),
});
let browser;
try {
  await bridge.start();
  const normal = path.join(temporary, 'normal'),
    dev = path.join(temporary, 'development');
  await cp(path.join(root, 'dist/chrome'), normal, { recursive: true });
  await cp(path.join(root, 'dist/development/chrome'), dev, { recursive: true });
  for (const dir of [normal, dev]) {
    const p = path.join(dir, 'manifest.json');
    const m = JSON.parse(await readFile(p, 'utf8'));
    m.host_permissions.push('http://*.example.com/*', 'https://*.example.com/*');
    await writeFile(p, JSON.stringify(m));
  }
  browser = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${normal},${dev}`, `--load-extension=${normal},${dev}`],
  });
  browser.setDefaultTimeout(15000);
  const deadline = Date.now() + 15000;
  while (browser.serviceWorkers().length < 2 && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(browser.serviceWorkers().length, 2);
  const identities = await Promise.all(
    browser.serviceWorkers().map(async (worker) => ({
      id: new URL(worker.url()).host,
      name: await worker.evaluate(() => chrome.runtime.getManifest().name),
    })),
  );
  const prodId = identities.find((i) => !i.name.includes('Development')).id;
  const devId = identities.find((i) => i.name.includes('Development')).id;
  const page = await browser.newPage();
  await page.goto(bridge.createConnectionUrl(), { waitUntil: 'commit' });
  await page.waitForURL(`chrome-extension://${devId}/options.html`);
  assert.equal(bridge.connectionStatus().extension.development, true);
  assert.match(bridge.connectionStatus().extension.name, /Development/);
  assert.match(bridge.connectionStatus().extension.icon, /^data:image\/png;base64,/);
  assert.ok(bridge.connectionStatus().extension.browserVersion);
  assert.ok(bridge.connectionStatus().extension.cpu);
  console.log('Development handoff selects the matching extension with both installed.');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.locator('#connect').waitFor({ state: 'visible' });
  await bridge.setDevelopment(false);
  await page.goto(bridge.createConnectionUrl(), { waitUntil: 'commit' });
  await page.waitForURL(`chrome-extension://${prodId}/options.html`);
  assert.equal(bridge.connectionStatus().extension.development, false);
  console.log('Standard handoff selects the normal extension.');
  // Keep only one extension opted into each mode; toggle through the real settings UI.
  const devPage = await browser.newPage();
  await devPage.goto(`chrome-extension://${devId}/options.html`);
  await devPage.getByRole('button', { name: 'Advanced connection options', exact: true }).click();
  await devPage
    .locator('label')
    .filter({
      has: devPage.getByRole('switch', { name: 'Use development connection', exact: true }),
    })
    .click();
  await devPage.waitForFunction(
    () => !document.querySelector('.advanced-body input[type=checkbox]').checked,
  );
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.locator('#connect').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Advanced connection options', exact: true }).click();
  await page
    .locator('label')
    .filter({ has: page.getByRole('switch', { name: 'Use development connection', exact: true }) })
    .click();
  await page
    .getByRole('dialog', { name: 'Use development connection' })
    .getByRole('button', { name: 'Enable', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('#connect') && !document.querySelector('#connect').disabled,
  );
  await bridge.setDevelopment(true);
  await page.goto(bridge.createConnectionUrl(), { waitUntil: 'commit' });
  await page.waitForURL(`chrome-extension://${prodId}/options.html`);
  assert.equal(bridge.connectionStatus().extension.development, false);
  console.log(
    'Regular build explicitly opted into development connects when both sides enable it.',
  );
  // Host permission is pregranted in an isolated fixture to keep browser chrome prompts out of this test.
  const session = await browser.newCDPSession(page);
  await session.send('Runtime.evaluate', {
    expression: `chrome.permissions.request({origins:['http://*.example.com/*','https://*.example.com/*']})`,
    awaitPromise: true,
    userGesture: true,
  });
  const before = approvals.length;
  await page.getByRole('button', { name: 'Enable all Providers', exact: true }).click();
  assert.equal(approvals.length, before);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.draft-footer').waitFor({ state: 'hidden' });
  assert.equal(approvals.length, before + 1);
  await page.getByRole('button', { name: 'Disable all Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(approvals.length, before + 1);
  console.log('Draft/apply sends one approval; Cancel makes no request.');
  await page.getByRole('button', { name: 'Compact cards', exact: true }).click();
  await page.locator('.provider-card-open').click();
  await page.locator('.provider-dialog[open]').waitFor();
  assert.equal(
    await page
      .locator('.provider-dialog .provider-icon')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/kawaikara-provider-card.png', fullPage: true });
  await page
    .locator('.provider-dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.reload();
  await page.locator('.provider-card-compact').waitFor();
  // Two independent extensions coexist; desktop revocation affects only the selected connection.
  await bridge.setDevelopment(false);
  const extra = await browser.newPage();
  await extra.goto(bridge.createConnectionUrl(), { waitUntil: 'commit' });
  await extra.waitForURL(`chrome-extension://${devId}/options.html`);
  assert.equal(bridge.connectionStatus().connections.length, 2);
  const normalClient = bridge.connectionStatus().connections.find((c) => c.client.endsWith(prodId));
  await bridge.revoke(normalClient.id);
  await page.locator('#connect').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Open Kawaikara', exact: true }).count(), 0);
  assert.equal(bridge.connectionStatus().connections.length, 1);
  await extra
    .getByRole('button', { name: 'Disconnect', exact: true })
    .waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.getByRole('combobox', { name: '언어', exact: true }).waitFor();
  await page.reload();
  assert.equal(await page.getByRole('combobox', { name: '언어', exact: true }).inputValue(), 'ko');
  await page.screenshot({ path: '/tmp/kawaikara-extension-options.png', fullPage: true });
  console.log('Independent clients, app revocation and persistent language selection verified.');
  const preview = await browser.newPage();
  const link = new URL(bridge.createConnectionUrl());
  await preview.goto(link.origin + link.pathname);
  await preview.locator('#installation').waitFor({ state: 'visible' });
  assert.equal(await preview.locator('[data-development-only]').first().isVisible(), false);
  assert.equal(await preview.locator('[data-production-only]').isVisible(), true);
  await preview.screenshot({ path: '/tmp/kawaikara-connection-preview.png' });
  await preview.goto(link.origin + link.pathname + '#preview:development');
  await preview.reload();
  assert.equal(await preview.locator('[data-development-only]').first().isVisible(), true);
  assert.equal(await preview.locator('[data-production-only]').isVisible(), false);
  console.log('Connection panel screenshot: /tmp/kawaikara-connection-preview.png');
  await bridge.dispose();
  await extra.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await extra.locator('#connect').waitFor({ state: 'visible' });
  const pendingNotice = extra.getByText(
    'Disconnected in this browser. Kawaikara will be notified when it is available and this extension is running.',
    { exact: true },
  );
  await pendingNotice.waitFor();
  assert.equal(bridge.connectionStatus().connections.length, 1);
  await bridge.start();
  await extra.getByRole('button', { name: 'Refresh', exact: true }).click();
  await pendingNotice.waitFor({ state: 'hidden' });
  assert.equal(bridge.connectionStatus().connections.length, 0);
  assert.equal(await extra.locator('#connect').isVisible(), true);
  console.log(
    'Offline disconnect queued and acknowledged after desktop restart without reconnecting.',
  );
} finally {
  await browser?.close();
  await bridge.dispose();
  await rm(temporary, { recursive: true, force: true });
}
