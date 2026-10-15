import kawaikaraIcon from '../icons/icon-32.png';
import { closeProviderMenu, isProviderInsertionTarget } from './provider-dom';
import { t } from './i18n';
import { webExtensionItemTitle } from './provider-contract';
import type { WebExtensionItem, WebExtensionMenu } from './provider-contract';
import type { ActiveProvider, ContentState, Reply } from './types';
type ActiveState = ContentState & {
  provider: ActiveProvider;
  recipe: WebExtensionMenu;
};
// Every site-specific selector and class comes from a Provider; executable logic is packaged here.
(function (api) {
  'use strict';
  if (globalThis.__kawaikaraProviderRenderer) {
    void globalThis.__kawaikaraProviderRenderer();
    return;
  }
  const documentKey = crypto.randomUUID();
  let states: ActiveState[] = [];
  let notification: HTMLElement | undefined;
  function showError(error: string) {
    notification?.remove();
    const node = document.createElement('div');
    node.setAttribute('role', 'alert');
    node.textContent = error;
    Object.assign(node.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      maxWidth: '360px',
      padding: '14px 18px',
      borderRadius: '10px',
      background: '#26232e',
      color: '#fff',
      font: '14px/1.5 system-ui',
      boxShadow: '0 4px 24px #0006',
    });
    document.documentElement.append(node);
    notification = node;
    setTimeout(() => {
      node.remove();
      if (notification === node) notification = undefined;
    }, 5000);
  }
  let generation = 0;
  let resolved = false;
  const menuRestorations = new Set<() => void>();
  const owned = new Set<HTMLElement>();
  const timers = new Set<number>();
  function cleanup() {
    generation++;
    for (const restore of menuRestorations) restore();
    menuRestorations.clear();
    for (const node of owned) node.remove();
    owned.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }
  function accept(result: ContentState) {
    resolved = true;
    states = result.providers.flatMap((provider) =>
      (provider.domActions || []).map((recipe) => ({ ...result, provider, recipe })),
    );
    later(
      () => {
        void refresh();
      },
      Math.max(0, result.expires - Date.now()),
    );
  }
  async function refresh() {
    cleanup();
    states = [];
    resolved = false;
    const current = generation;
    try {
      const reply: Reply<ContentState> = await api.runtime.sendMessage({
        type: 'provider-state',
      });
      if (current !== generation || reply.error || !reply.result) return;
      accept(reply.result);
    } catch {
      /* Revoked/disconnected extension contexts have no authority. */
    }
  }
  function createItem(
    declaration: WebExtensionItem,
    menu: HTMLElement,
    recipe: WebExtensionMenu,
    captured: ActiveState,
  ) {
    const action = declaration.action;
    const item = document.createElement(recipe.layout === 'button-list' ? 'li' : 'div');
    item.className = recipe.itemClass;
    item.setAttribute('role', 'menuitem');
    item.dataset.kawaikaraProvider = captured.provider.id;
    item.dataset.kawaikaraRecipe = recipe.id;
    const brandIcon = document.createElement('img');
    brandIcon.src = kawaikaraIcon;
    brandIcon.alt = '';
    brandIcon.draggable = false;
    brandIcon.setAttribute('aria-hidden', 'true');
    Object.assign(brandIcon.style, {
      width: '20px',
      height: '20px',
      objectFit: 'contain',
      verticalAlign: 'middle',
      flexShrink: '0',
    });
    let label: HTMLElement;
    let trigger: HTMLElement;
    if (recipe.layout === 'button-list') {
      const button = document.createElement('button');
      button.type = 'button';
      trigger = button;
      trigger.className = recipe.buttonClass || '';
      label = document.createElement('span');
      brandIcon.style.marginInlineEnd = '8px';
      button.append(brandIcon, label);
      item.append(trigger);
    } else {
      trigger = item;
      trigger.tabIndex = 0;
      const icon = document.createElement('div');
      icon.className = recipe.iconClass || '';
      icon.append(brandIcon);
      Object.assign(icon.style, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      });
      label = document.createElement('div');
      label.className = recipe.labelClass || '';
      const content = document.createElement('div');
      content.className = recipe.contentClass || '';
      item.append(icon, label, content);
    }
    label.textContent = webExtensionItemTitle(declaration, api.i18n.getUILanguage());
    let pending = false;
    async function activate(event: Event) {
      if (
        !event.isTrusted ||
        pending ||
        !states.includes(captured) ||
        Date.now() > captured.expires
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      pending = true;
      try {
        const reply = await api.runtime.sendMessage({
          type: 'provider-action',
          documentKey,
          url: location.href,
          action,
          providerId: captured.provider.id,
          revision: captured.revision,
        });
        if (reply.error) {
          showError(reply.error);
          return;
        }
        if (reply.result?.copied) label.textContent = t('clipboardCopied');
        if (states.includes(captured) && Date.now() <= captured.expires) {
          const restore = closeProviderMenu(menu, item, recipe.close);
          if (restore) menuRestorations.add(restore);
        }
      } catch {
        void refresh();
      } finally {
        pending = false;
      }
    }
    trigger.addEventListener('click', activate);
    if (recipe.layout === 'menu-item')
      trigger.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' '))
          void activate(event);
      });
    owned.add(item);
    return item;
  }
  function inject(captured: ActiveState, version: number) {
    if (!states.includes(captured) || generation !== version || Date.now() > captured.expires)
      return;
    try {
      const menu = document.querySelector(captured.recipe.target);
      if (!isProviderInsertionTarget(menu)) return;
      const recipe = captured.recipe;
      const declarations = recipe.items.filter(
        (item) => !item.when || captured.provider.values[item.when],
      );
      const existing = [...owned].filter(
        (item) =>
          item.dataset.kawaikaraProvider === captured.provider.id &&
          item.dataset.kawaikaraRecipe === recipe.id,
      );
      // Retry only when the site's menu appeared or was replaced. Recreating live
      // nodes on every retry discards keyboard focus and in-flight user clicks.
      if (
        existing.length === declarations.length &&
        existing.every((item) => item.parentElement === menu)
      )
        return;
      for (const item of existing) {
        item.remove();
        owned.delete(item);
      }
      menu[recipe.placement || 'prepend'](
        ...declarations.map((item) => createItem(item, menu, recipe, captured)),
      );
    } catch {
      /* A site redesign or invalid selector disables only this descriptor. */
    }
  }
  for (const eventType of ['contextmenu', 'click'])
    document.addEventListener(
      eventType,
      async (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        if (event.target.closest('[data-kawaikara-provider]')) return;
        // The first right click can arrive before the authenticated catalog reply.
        if (!resolved) await refresh();
        for (const captured of states)
          try {
            if (captured.recipe.event !== eventType) continue;
            const player = event.target.closest(captured.recipe.trigger);
            if (
              !player ||
              (captured.recipe.requireVideo &&
                !(player.matches('video') || player.querySelector('video')))
            )
              continue;
            const version = generation;
            for (const delay of [0, 40, 120]) later(() => inject(captured, version), delay);
          } catch {
            /* Invalid selector. */
          }
      },
      true,
    );
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (message.type === 'kawaikara-document') {
      respond({ documentKey, url: location.href });
      return;
    }
    if (message.type !== 'kawaikara-refresh') return;
    // Apply the authorized snapshot synchronously. Do not start a second catalog
    // fetch or reinject the renderer while the background is applying this update.
    if (message.state) {
      cleanup();
      accept(message.state);
      respond({ ok: true });
    } else void refresh();
  });
  globalThis.__kawaikaraProviderRenderer = refresh;
  void refresh();
})(globalThis.chrome);
