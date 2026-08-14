/* global KawaikaraSupport */

if (!globalThis.KawaikaraSupport && typeof importScripts === 'function') {
  importScripts('supported-sites.js');
}

(function initializeExtension(api, support) {
  'use strict';

  const MENU_PAGE_OPEN = 'kawaikara-open-page';
  const MENU_PAGE_COPY = 'kawaikara-copy-page-link';
  const MENU_LINK_OPEN = 'kawaikara-open-link';
  const MENU_LINK_COPY = 'kawaikara-copy-target-link';
  const supportedPatterns = support.getMatchPatterns();

  function getMessage(name, fallback) {
    return api.i18n.getMessage(name) || fallback;
  }

  function createContextMenus() {
    api.contextMenus.removeAll(() => {
      void api.runtime.lastError;
      api.contextMenus.create({
        id: MENU_PAGE_OPEN,
        title: getMessage('openInKawaikara', 'Open in Kawaikara'),
        contexts: ['page', 'video'],
        documentUrlPatterns: supportedPatterns,
      });
      api.contextMenus.create({
        id: MENU_PAGE_COPY,
        title: getMessage('copyKawaikaraLink', 'Copy Kawaikara link'),
        contexts: ['page', 'video'],
        documentUrlPatterns: supportedPatterns,
      });
      api.contextMenus.create({
        id: MENU_LINK_OPEN,
        title: getMessage('openLinkInKawaikara', 'Open link in Kawaikara'),
        contexts: ['link'],
        targetUrlPatterns: supportedPatterns,
      });
      api.contextMenus.create({
        id: MENU_LINK_COPY,
        title: getMessage('copyKawaikaraLink', 'Copy Kawaikara link'),
        contexts: ['link'],
        targetUrlPatterns: supportedPatterns,
      });
    });
  }

  function supportedCandidate(...values) {
    return values.find(
      (value) => typeof value === 'string' && support.isSupportedUrl(value),
    );
  }

  function launch(targetUrl, tabId) {
    const deepLink = support.createDeepLink(targetUrl);
    if (!deepLink) {
      return;
    }

    if (typeof tabId === 'number') {
      api.tabs.update(tabId, { url: deepLink }, () => {
        const error = api.runtime.lastError;
        if (error) {
          api.tabs.create({ url: deepLink }, () => void api.runtime.lastError);
        }
      });
      return;
    }

    api.tabs.create({ url: deepLink }, () => void api.runtime.lastError);
  }

  function copyDeepLink(targetUrl, tabId) {
    const shareLink = support.createShareLink(targetUrl);
    if (!shareLink || typeof tabId !== 'number') {
      return;
    }

    api.scripting.executeScript(
      {
        target: { tabId },
        func: async (value) => {
          try {
            await navigator.clipboard.writeText(value);
            return true;
          } catch {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.append(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            return copied;
          }
        },
        args: [shareLink],
      },
      () => void api.runtime.lastError,
    );
  }

  api.runtime.onInstalled.addListener(createContextMenus);
  api.runtime.onStartup.addListener(createContextMenus);

  api.contextMenus.onClicked.addListener((info, tab) => {
    const isLinkAction =
      info.menuItemId === MENU_LINK_OPEN || info.menuItemId === MENU_LINK_COPY;
    const targetUrl =
      isLinkAction
        ? supportedCandidate(info.linkUrl)
        : supportedCandidate(info.pageUrl, info.frameUrl, info.srcUrl, tab?.url);
    if (!targetUrl) {
      return;
    }

    if (
      info.menuItemId === MENU_PAGE_COPY ||
      info.menuItemId === MENU_LINK_COPY
    ) {
      copyDeepLink(targetUrl, tab?.id);
    } else {
      launch(targetUrl, tab?.id);
    }
  });

  api.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type === 'kawaikara-open' &&
      typeof message.url === 'string' &&
      support.isSupportedUrl(message.url)
    ) {
      launch(message.url, sender.tab?.id);
    }
  });

  api.action.onClicked.addListener((tab) => {
    const targetUrl = supportedCandidate(tab.url);
    if (targetUrl) {
      launch(targetUrl, tab.id);
    }
  });
})(globalThis.chrome, globalThis.KawaikaraSupport);
