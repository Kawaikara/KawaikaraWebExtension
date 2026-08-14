/* global KawaikaraSupport */

(function initializeYouTubeContextMenu(api, support) {
  'use strict';

  const ITEM_CLASS = 'kawaikara-youtube-menuitem';
  const INJECTION_DELAYS = [0, 40, 120];

  function getMessage(name, fallback) {
    return api.i18n.getMessage(name) || fallback;
  }

  function isYouTubeVideoContext(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      target.closest('video, #movie_player, .html5-video-player')?.querySelector('video') ??
        target.closest('video'),
    );
  }

  function closeYouTubeMenu(menu) {
    const contextMenu = menu.closest('.ytp-contextmenu');
    if (contextMenu instanceof HTMLElement) {
      contextMenu.style.display = 'none';
      setTimeout(() => contextMenu.style.removeProperty('display'), 0);
    }
  }

  function createMenuItem(label, onActivate) {
    const item = document.createElement('div');
    item.className = `ytp-menuitem ${ITEM_CLASS}`;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');

    const icon = document.createElement('div');
    icon.className = 'ytp-menuitem-icon';
    icon.textContent = 'K';

    const labelElement = document.createElement('div');
    labelElement.className = 'ytp-menuitem-label';
    labelElement.textContent = label;

    const content = document.createElement('div');
    content.className = 'ytp-menuitem-content';

    item.append(icon, labelElement, content);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onActivate(labelElement);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });
    return item;
  }

  async function copyDeepLink(labelElement) {
    const shareLink = support.createShareLink(location.href);
    if (!shareLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareLink;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    labelElement.textContent = getMessage('kawaikaraLinkCopied', 'Kawaikara link copied');
  }

  function injectMenuItems() {
    const menu = document.querySelector('.ytp-contextmenu .ytp-panel-menu');
    if (!(menu instanceof HTMLElement)) {
      return;
    }

    menu.querySelectorAll(`.${ITEM_CLASS}`).forEach((item) => item.remove());

    const openItem = createMenuItem(
      getMessage('openInKawaikara', 'Open in Kawaikara'),
      () => {
        closeYouTubeMenu(menu);
        api.runtime.sendMessage({
          type: 'kawaikara-open',
          url: location.href,
        });
      },
    );
    const copyItem = createMenuItem(
      getMessage('copyKawaikaraLink', 'Copy Kawaikara link'),
      (labelElement) => copyDeepLink(labelElement),
    );

    // Keep Kawaikara actions visible without scrolling through YouTube's
    // increasingly long native player menu.
    menu.prepend(openItem, copyItem);
  }

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!isYouTubeVideoContext(event.target)) {
        return;
      }
      for (const delay of INJECTION_DELAYS) {
        setTimeout(injectMenuItems, delay);
      }
    },
    true,
  );
})(globalThis.chrome, globalThis.KawaikaraSupport);
