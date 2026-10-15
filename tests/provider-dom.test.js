const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const code = buildSync({
  entryPoints: ['src/provider-dom.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'ProviderDom',
  write: false,
}).outputFiles[0].text;
test('DOM targets permit menu containers but cannot insert into document roots or editable/interactive content', () => {
  const dom = new JSDOM(
    '<main><div id="menu"></div><div contenteditable="true"><div id="editor"></div></div><button><span id="button-child"></span></button><textarea></textarea><script></script><style></style></main>',
    { runScripts: 'outside-only' },
  );
  try {
    const { isProviderInsertionTarget: allowed } = dom.window.eval(code + ';ProviderDom;');
    const d = dom.window.document;
    assert.equal(allowed(d.querySelector('#menu')), true);
    for (const selector of [
      'html',
      'body',
      'head',
      '#editor',
      '#button-child',
      'textarea',
      'script',
      'style',
    ])
      assert.equal(allowed(d.querySelector(selector)), false, selector);
    assert.equal(allowed(d.createElement('div')), false);
    assert.equal(allowed(null), false);
  } finally {
    dom.window.close();
  }
});

test('closing stays inside the active small menu and restores only adapter changes', () => {
  const dom = new JSDOM(
    '<main><div id="popup"><div id="menu"><div id="item"></div></div></div><div id="unrelated"></div></main>',
    { runScripts: 'outside-only' },
  );
  try {
    const { closeProviderMenu: close } = dom.window.eval(code + ';ProviderDom;');
    const d = dom.window.document,
      popup = d.querySelector('#popup'),
      menu = d.querySelector('#menu'),
      item = d.querySelector('#item');
    popup.getBoundingClientRect = () => ({ width: 250, height: 150 });
    assert.equal(close(menu, item, 'body'), undefined);
    assert.equal(close(menu, item, 'main'), undefined);
    assert.equal(close(menu, item, '#unrelated'), undefined);
    assert.equal(close(menu, item, '['), undefined);
    const restore = close(menu, item, '#popup');
    assert.equal(popup.style.display, 'none');
    restore();
    assert.equal(popup.style.display, '');
    popup.append(d.createElement('video'));
    assert.equal(close(menu, item, '#popup'), undefined);
    popup.querySelector('video').remove();
    popup.getBoundingClientRect = () => ({ width: 900, height: 700 });
    assert.equal(close(menu, item, '#popup'), undefined);
    popup.getBoundingClientRect = () => ({ width: 250, height: 150 });
    const restoreAgain = close(menu, item, '#popup');
    popup.style.display = 'flex';
    restoreAgain();
    assert.equal(popup.style.display, 'flex');
    item.remove();
    assert.equal(close(menu, item, '#popup'), undefined);
  } finally {
    dom.window.close();
  }
});
