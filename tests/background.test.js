const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const support = require('../src/supported-sites.js');

function loadBackground() {
  const listeners = {};
  const createdMenus = [];
  const copiedLinks = [];
  const updatedTabs = [];
  const chrome = {
    runtime: {
      lastError: undefined,
      onInstalled: { addListener: (listener) => (listeners.installed = listener) },
      onStartup: { addListener: (listener) => (listeners.startup = listener) },
      onMessage: { addListener: (listener) => (listeners.message = listener) },
    },
    i18n: { getMessage: (name) => name },
    contextMenus: {
      removeAll: (callback) => callback(),
      create: (properties) => createdMenus.push(properties),
      onClicked: { addListener: (listener) => (listeners.menuClicked = listener) },
    },
    action: {
      onClicked: { addListener: (listener) => (listeners.actionClicked = listener) },
    },
    tabs: {
      update: (tabId, properties, callback) => {
        updatedTabs.push({ tabId, ...properties });
        callback();
      },
      create: () => {
        throw new Error('The fallback tab should not be needed in this test.');
      },
    },
    scripting: {
      executeScript: (details, callback) => {
        copiedLinks.push(details.args[0]);
        callback();
      },
    },
  };
  const context = vm.createContext({ chrome, KawaikaraSupport: support });
  const source = fs.readFileSync(
    path.join(__dirname, '../src/background.js'),
    'utf8',
  );
  vm.runInContext(source, context);
  return { copiedLinks, createdMenus, listeners, updatedTabs };
}

test('creates open and copy menus for supported pages, videos, and links', () => {
  const { createdMenus, listeners } = loadBackground();
  listeners.installed();

  assert.equal(createdMenus.length, 4);
  assert.deepEqual(Array.from(createdMenus[0].contexts), ['page', 'video']);
  assert.deepEqual(Array.from(createdMenus[1].contexts), ['page', 'video']);
  assert.deepEqual(Array.from(createdMenus[2].contexts), ['link']);
  assert.deepEqual(Array.from(createdMenus[3].contexts), ['link']);
  assert.ok(createdMenus[0].documentUrlPatterns.includes('*://youtube.com/*'));
  assert.ok(createdMenus[2].targetUrlPatterns.includes('*://*.netflix.com/*'));
});

test('copies a Discord-friendly Kawaikara share link for a video page', () => {
  const { copiedLinks, listeners } = loadBackground();
  listeners.menuClicked(
    {
      menuItemId: 'kawaikara-copy-page-link',
      pageUrl: 'https://www.youtube.com/watch?v=copy123',
    },
    { id: 11 },
  );

  assert.equal(copiedLinks.length, 1);
  const shareLink = new URL(copiedLinks[0]);
  assert.equal(shareLink.origin, 'https://kawaikara.github.io');
  assert.equal(shareLink.pathname, '/open/');
  assert.equal(
    shareLink.searchParams.get('url'),
    'https://www.youtube.com/watch?v=copy123',
  );
});

test('opens the page URL when the video menu is clicked', () => {
  const { listeners, updatedTabs } = loadBackground();
  listeners.menuClicked(
    {
      menuItemId: 'kawaikara-open-page',
      pageUrl: 'https://www.youtube.com/watch?v=abc123',
      srcUrl: 'blob:https://www.youtube.com/media',
    },
    { id: 42 },
  );

  assert.equal(updatedTabs.length, 1);
  assert.equal(updatedTabs[0].tabId, 42);
  const deepLink = new URL(updatedTabs[0].url);
  assert.equal(
    deepLink.searchParams.get('url'),
    'https://www.youtube.com/watch?v=abc123',
  );
});

test('opens a supported link target instead of the current page', () => {
  const { listeners, updatedTabs } = loadBackground();
  listeners.menuClicked(
    {
      menuItemId: 'kawaikara-open-link',
      linkUrl: 'https://www.netflix.com/watch/123',
      pageUrl: 'https://example.com/',
    },
    { id: 7 },
  );

  const deepLink = new URL(updatedTabs[0].url);
  assert.equal(
    deepLink.searchParams.get('url'),
    'https://www.netflix.com/watch/123',
  );
});
