// Isolated Chromium fixture for trusted clicks; does not use a personal browser profile.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(
  path.resolve(import.meta.dirname, '../../kawaikara/dev3/package.json'),
);
const { chromium } = require('patchright');
const root = path.resolve(import.meta.dirname, '..');
const script = await readFile(root + '/dist/chrome/provider-content.js', 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERROR', e.message));
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>#player{width:640px;height:360px;background:#333;color:white}#popup{width:250px;background:#ddd;color:black;padding:12px}button{padding:8px}</style><div id="player">Player</div><div id="popup"><div id="menu"></div></div>',
    }),
  );
  for (const layout of ['menu-item', 'button-list']) {
    await page.goto('http://localhost/test');
    await page.evaluate((layout) => {
      window.calls = [];
      const provider = {
        id: 'test',
        values: {},
        domActions: [
          {
            id: 'menu',
            event: 'contextmenu',
            trigger: '#player',
            target: '#menu',
            close: '#popup',
            layout,
            itemClass: 'entry',
            items: [
              { id: 'open', action: 'open', title: 'Open in Kawaikara' },
              { id: 'copy', action: 'copy', title: 'Copy' },
            ],
          },
        ],
      };
      window.chrome = {
        i18n: { getUILanguage: () => 'en', getMessage: (key) => key },
        runtime: {
          id: 'test',
          onMessage: { addListener() {} },
          sendMessage: async (message) => {
            if (message.type === 'provider-state')
              return {
                result: { providers: [provider], revision: '1', expires: Date.now() + 60000 },
              };
            window.calls.push(message);
            return { result: { copied: message.action === 'copy' } };
          },
        },
      };
    }, layout);
    await page.evaluate(script);
    console.log('injected', layout);
    await page.locator('#player').click({ button: 'right' });
    await page.getByText('Open in Kawaikara', { exact: true }).waitFor();
    if ((await page.locator('#menu img').count()) !== 2) throw Error('Missing brand icons');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#menu img')].every((i) => i.complete && i.naturalWidth > 0),
    );
    await page.getByText('Open in Kawaikara', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#popup').style.display === 'none');
    await page.locator('#player').click({ button: 'right' });
    await page.getByText('Copy', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#popup').style.display === 'none');
    if ((await page.evaluate(() => window.calls.length)) !== 2)
      throw Error('Duplicate or missing action');
    console.log('PASS: ' + layout + ' icons, action, close and reopen');
  }
} finally {
  await browser.close();
}
