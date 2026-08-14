/* global KawaikaraSupport */

(function initializeChzzkContextMenu(api, support) {
  'use strict';

  const ITEM_CLASS = 'kawaikara-chzzk-menuitem';
  const INJECTION_DELAYS = [0, 40, 120];

  function getMessage(name, fallback) {
    return api.i18n.getMessage(name) || fallback;
  }

  function isChzzkVideoContext(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    if (target.closest('video')) {
      return true;
    }
    const player = target.closest(
      '.pzp-pc, .webplayer-internal-source-wrapper, [class*="pzp-pc__"]',
    );
    return Boolean(player?.querySelector('video'));
  }

  function closeChzzkMenu(menu) {
    const contextMenu = menu.closest('.pzp-contextmenu-pane');
    if (contextMenu instanceof HTMLElement) {
      contextMenu.style.display = 'none';
      setTimeout(() => contextMenu.style.removeProperty('display'), 0);
    }
  }

  function createMenuItem(label, onActivate) {
    const item = document.createElement('li');
    item.className =
      `pzp-ui-contextmenu-item pzp-contextmenu-pane__list-item ${ITEM_CLASS}`;
    item.setAttribute('role', 'menuitem');

    const button = document.createElement('button');
    button.className = 'pzp-ui-contextmenu-item__button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onActivate(button);
    });

    item.append(button);
    return item;
  }

  async function copyDeepLink(button) {
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
    button.textContent = getMessage(
      'kawaikaraLinkCopied',
      'Kawaikara link copied',
    );
  }

  function injectMenuItems() {
    const menu = document.querySelector(
      '.pzp-contextmenu-pane .pzp-contextmenu-pane__list',
    );
    if (!(menu instanceof HTMLElement)) {
      return;
    }

    menu.querySelectorAll(`.${ITEM_CLASS}`).forEach((item) => item.remove());

    const openItem = createMenuItem(
      getMessage('openInKawaikara', 'Open in Kawaikara'),
      () => {
        closeChzzkMenu(menu);
        api.runtime.sendMessage({
          type: 'kawaikara-open',
          url: location.href,
        });
      },
    );
    const copyItem = createMenuItem(
      getMessage('copyKawaikaraLink', 'Copy Kawaikara link'),
      (button) => copyDeepLink(button),
    );

    // Keep Kawaikara actions visible without scrolling through CHZZK's
    // native player menu.
    menu.prepend(openItem, copyItem);
  }

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!isChzzkVideoContext(event.target)) {
        return;
      }
      for (const delay of INJECTION_DELAYS) {
        setTimeout(injectMenuItems, delay);
      }
    },
    true,
  );
})(globalThis.chrome, globalThis.KawaikaraSupport);
