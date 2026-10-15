declare const __KAWAIKARA_FIREFOX__: boolean;
import { development, extensionInfo } from './build-info';
import { t, setLocale, type Locale } from './i18n';
import type {
  WebExtensionProvider,
  WebExtensionAction,
  WebExtensionContextItem,
} from './provider-contract';
import type { Connection, Catalog, ActiveProvider } from './types';
import { errorMessage, parseMessage } from './types';
import { providerHostPatterns } from './host-permissions';
/* global KawaikaraContract */
if (!globalThis.KawaikaraContract && typeof importScripts === 'function') {
  importScripts('provider-contract.js');
}
(function (api: typeof chrome, contract: typeof KawaikaraContract) {
  'use strict';
  const patterns = providerHostPatterns;
  const client = api.runtime.getURL('').replace(/\/$/, '');
  let connection: Connection | undefined;
  let pendingDisconnects: Connection[] = [];
  let disconnectTask: Promise<void> | undefined;
  let developmentConnection = development;
  let language: Locale = 'system';
  let instanceId = '';
  let disconnectedByApp = false;
  class RevokedConnection extends Error {}
  let snapshot: Catalog = {
    version: 2,
    revision: '',
    providers: [],
    grants: [],
  };
  let active: ActiveProvider[] = [];
  let readyAt = 0;
  let syncTask: Promise<void> | undefined;
  let applyKey = '';
  let lastError = '';
  let startupError = '';
  let loaded = false;
  const menuRoutes = new Map<
    string,
    { providerId: string; item: WebExtensionContextItem; revision: string }
  >();

  async function request<T = Record<string, unknown>>(
    route: string,
    body?: object,
    setup?: Connection,
  ): Promise<T | null> {
    const config = setup || connection;
    if (!config) throw new Error('Connect Kawaikara in extension settings.');
    const nonce = crypto.randomUUID();
    const response = await fetch(`${config.url}/v1/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'X-Kawaikara-Client': client,
        'X-Kawaikara-Instance': instanceId,
        'X-Kawaikara-Nonce': nonce,
        ...(body === undefined
          ? { 'If-None-Match': `"${snapshot.revision}"` }
          : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(
        route === 'disconnect' ? 3000 : body === undefined ? 5000 : 120000,
      ),
    });
    if (response.status === 304) return null;
    const text = await response.text();
    if (route !== 'catalog' && text.length > 524288) throw new Error('Catalog too large.');
    const data = JSON.parse(text);
    if (response.status === 401 && data.error === 'revoked' && typeof data.proof === 'string') {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(config.token),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`revoked\n${nonce}\n${client}`),
      );
      const proof = Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      if (proof === data.proof) throw new RevokedConnection('Disconnected by Kawaikara.');
    }
    if (!response.ok) throw new Error(data.error || `Bridge error ${response.status}`);
    return data as T;
  }

  function requireConnection(input: unknown): Connection {
    if (!input || typeof input !== 'object') throw new Error('Invalid connection code.');
    const value = input as Record<string, unknown>;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(value.url) ||
      typeof value.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.token)
    )
      throw new Error('Invalid connection code.');
    const url = new URL(value.url);
    if (+url.port < 1024 || +url.port > 65535) throw new Error('Invalid bridge port.');
    if (
      value.launchUrl !== undefined &&
      value.launchUrl !== null &&
      value.launchUrl !== 'kawaikara://bridge/wake'
    )
      throw new Error('Unsupported desktop launcher.');
    return {
      version: 1,
      url: url.origin,
      token: value.token,
      ...(value.launchUrl !== undefined ? { launchUrl: value.launchUrl as string | null } : {}),
    };
  }

  async function discover(
    authenticated = false,
    developmentApp = false,
    identity = connection,
  ): Promise<Connection> {
    const nonce = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const key =
      authenticated && identity
        ? await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(identity.token),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          )
        : undefined;
    const found = await Promise.all(
      contract.WEB_EXTENSION_DISCOVERY_PORTS.map(async (port) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/v1/discover${authenticated ? `?nonce=${nonce}` : ''}`,
            {
              headers: { 'X-Kawaikara-Client': client, 'X-Kawaikara-Instance': instanceId },
              credentials: 'omit',
              cache: 'no-store',
              redirect: 'error',
              signal: AbortSignal.timeout(1500),
            },
          );
          if (!response.ok) return undefined;
          const body = await response.text();
          if (body.length > 2048) return undefined;
          const value = JSON.parse(body);
          if (value.protocol !== 'kawaikara-web-extension' || value.adapterVersion !== 2)
            return undefined;
          if (!authenticated && (value.development === true) !== developmentApp) return undefined;
          const candidate = requireConnection({
            version: 1,
            url: value.url,
            token: '0'.repeat(64),
          });
          if (authenticated) {
            if (!key || !identity) return undefined;
            const signature = await crypto.subtle.sign(
              'HMAC',
              key,
              new TextEncoder().encode(`${nonce}\n${candidate.url}\n${client}`),
            );
            const proof = Array.from(new Uint8Array(signature), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
            if (value.proof !== proof) return undefined;
            candidate.token = identity.token;
            candidate.launchUrl = identity.launchUrl;
          }
          return candidate;
        } catch {
          return undefined;
        }
      }),
    );
    const candidates = [
      ...new Map(
        found
          .filter((entry): entry is Connection => Boolean(entry))
          .map((entry) => [entry.url, entry]),
      ).values(),
    ];
    if (identity) {
      const existing = candidates.find((entry) => entry.url === identity?.url);
      if (existing) return existing;
    }
    if (!candidates.length) throw new Error('Start or update Kawaikara, then try Connect again.');
    if (candidates.length > 1)
      throw new Error(
        'Multiple Kawaikara profiles are running. Close the others or use a connection code.',
      );
    return candidates[0];
  }

  // Only the old credential may authorize its own revocation. Never restore it as active.
  async function flushDisconnects() {
    if (disconnectTask) return disconnectTask;
    disconnectTask = (async () => {
      for (const pending of [...pendingDisconnects]) {
        try {
          // Prove identity before sending a retained credential, including after port migration.
          const endpoint = await discover(true, false, pending);
          const result = await request('disconnect', {}, endpoint);
          if (result?.ok !== true) continue;
        } catch (error) {
          if (!(error instanceof RevokedConnection)) continue;
        }
        pendingDisconnects = pendingDisconnects.filter((entry) => entry.token !== pending.token);
        await api.storage.local.set({ pendingDisconnects });
      }
    })().finally(() => {
      disconnectTask = undefined;
    });
    return disconnectTask;
  }

  async function synchronize() {
    if (syncTask) return syncTask;
    syncTask = (async () => {
      await flushDisconnects();
      try {
        if (connection) {
          let next: Catalog | null;
          try {
            next = await request<Catalog>('catalog');
          } catch (error) {
            if (error instanceof RevokedConnection) throw error;
            const recovered = await discover(true);
            next = await request<Catalog>('catalog', undefined, recovered);
            connection = recovered;
            await api.storage.local.set({ connection });
          }
          if (next) {
            if (
              next.version !== 2 ||
              !/^[a-f0-9]{64}$/.test(next.revision) ||
              !Array.isArray(next.grants)
            )
              throw new Error('Unsupported catalog.');
            contract.validateWebExtensionProviders(next.providers);
            snapshot = next;
            if (next.launchUrl !== undefined) {
              disconnectedByApp = false;
              connection = requireConnection({ ...connection, launchUrl: next.launchUrl });
              await api.storage.local.set({ connection });
            }
            await api.storage.local.set({
              catalogCache: { token: connection.token, savedAt: Date.now(), catalog: snapshot },
            });
          }
          readyAt = Date.now();
        }
        lastError = '';
      } catch (error) {
        readyAt = 0;
        if (error instanceof RevokedConnection) {
          connection = undefined;
          disconnectedByApp = true;
          snapshot = { version: 2, revision: '', providers: [], grants: [] };
          await api.storage.local.remove(['connection', 'catalogCache']);
          const saved = await api.storage.local.get(null);
          for (const key of Object.keys(saved))
            if (key.startsWith('pending:')) await api.storage.local.remove(key);
        }
        // Keep cached entry points. Execution still requires a fresh authenticated catalog.
        lastError = errorMessage(error);
      }
      await apply();
      await showStatus();
    })().finally(() => {
      syncTask = undefined;
    });
    return syncTask;
  }

  async function allowedProviders() {
    if (!connection) return [];
    const grants = snapshot.grants;
    const allowed = [];
    for (const provider of snapshot.providers) {
      const grant = grants.find(
        (entry) =>
          entry.id === provider.id && entry.key === contract.webExtensionPermissionKey(provider),
      );
      if (
        grant &&
        Array.isArray(grant.actions) &&
        (await api.permissions.contains({ origins: patterns(provider) }))
      ) {
        if (provider.actions.every((action) => grant.actions.includes(action)))
          allowed.push({
            ...provider,
            values: contract.webExtensionSettings(provider, grant.settings || {}),
          });
      }
    }
    return allowed;
  }

  async function apply() {
    active = await allowedProviders();
    const key = JSON.stringify([snapshot.revision, active]);
    if (key === applyKey) return;
    await api.contextMenus.removeAll();
    menuRoutes.clear();
    for (const provider of active) {
      for (const item of provider.contextMenus || []) {
        if (item.when && !provider.values[item.when]) continue;
        const id = JSON.stringify([provider.id, item.id]);
        menuRoutes.set(id, { providerId: provider.id, item, revision: snapshot.revision });
        await new Promise<void>((resolve, reject) =>
          api.contextMenus.create(
            {
              id,
              ...(__KAWAIKARA_FIREFOX__
                ? { icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } }
                : {}),
              title: contract.webExtensionItemTitle(item, api.i18n.getUILanguage()),
              contexts: [...item.contexts] as chrome.contextMenus.CreateProperties['contexts'],
              ...(item.contexts.includes('link')
                ? { targetUrlPatterns: patterns(provider) }
                : { documentUrlPatterns: patterns(provider) }),
            },
            () => {
              const error = api.runtime.lastError;
              if (error) reject(new Error(error.message));
              else resolve();
            },
          ),
        );
      }
    }
    const old = (await api.scripting.getRegisteredContentScripts()).filter(({ id }) =>
      id.startsWith('kawaikara-provider-'),
    );
    if (old.length)
      await api.scripting.unregisterContentScripts({
        ids: old.map(({ id }) => id),
      });
    const scripts: chrome.scripting.RegisteredContentScript[] = active
      .filter((provider) => provider.domActions?.length)
      .map((provider) => ({
        id: `kawaikara-provider-${provider.id}`,
        matches: patterns(provider),
        js: ['provider-content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: false,
      }));
    if (scripts.length) await api.scripting.registerContentScripts(scripts);
    // Unregistering a script does not remove existing nodes/listeners. Notify every reachable tab.
    const tabs = await api.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (typeof tab.id !== 'number') return;
        let rendered = false;
        try {
          const response = await api.tabs.sendMessage(
            tab.id,
            {
              type: 'kawaikara-refresh',
              state: {
                providers: active.filter((provider) =>
                  contract.resolveWebExtensionProvider([provider], tab.url || ''),
                ),
                revision: snapshot.revision,
                expires: Date.now() + 60000,
              },
            },
            { frameId: 0 },
          );
          rendered = response?.ok === true;
        } catch {
          /* No old renderer. */
        }
        if (scripts.length && !rendered) {
          try {
            if (
              active.some(
                (provider) =>
                  provider.domActions?.length &&
                  contract.resolveWebExtensionProvider([provider], tab.url || ''),
              )
            )
              await api.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['provider-content.js'],
              });
          } catch {
            /* Restricted/discarded tab; its next load uses the registration. */
          }
        }
      }),
    );
    applyKey = key;
  }

  async function showStatus() {
    const error = startupError || lastError;
    const awaitingVerification = Boolean(connection) && !readyAt;
    const text = development
      ? 'D'
      : awaitingVerification
        ? 'WAIT'
        : error
          ? '!'
          : !connection
            ? 'LINK'
            : active.length
              ? 'ON'
              : 'SET';
    await api.action.setBadgeText?.({ text });
    await api.action.setBadgeBackgroundColor?.({
      color: awaitingVerification
        ? '#965900'
        : error
          ? '#b42318'
          : active.length
            ? '#16794b'
            : '#965900',
    });
    const title = awaitingVerification
      ? `Kawaikara: ${t('appOffline')}`
      : error
        ? `Kawaikara: ${error}`
        : !connection
          ? t('extensionDisconnected')
          : active.length
            ? t('extensionReady')
            : t('extensionSetup');
    await api.action.setTitle?.({ title });
  }

  function providerFor(url: string) {
    const owner = contract.resolveWebExtensionProvider(snapshot.providers, url);
    return active.find((provider) => provider.id === owner?.id);
  }

  async function copyText(value: string, tabId: number) {
    await api.scripting.executeScript({
      target: { tabId },
      args: [value],
      func: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const input = document.createElement('textarea');
          input.value = text;
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.append(input);
          input.select();
          const ok = document.execCommand('copy');
          input.remove();
          if (!ok) throw new Error('Clipboard unavailable.');
        }
      },
    });
  }

  async function invoke(
    action: WebExtensionAction,
    url: string | undefined,
    tabId: number | undefined,
    expectedProvider?: string,
    expectedRevision?: string,
    allowWake = true,
    verifyDocument?: () => Promise<void>,
  ) {
    if (typeof url !== 'string' || typeof tabId !== 'number') throw new Error('Missing tab URL.');
    await synchronize();
    await verifyDocument?.();
    const provider = expectedProvider
      ? active.find(
          (entry) =>
            entry.id === expectedProvider && contract.resolveWebExtensionProvider([entry], url),
        )
      : providerFor(url);
    if (
      !provider?.actions.includes(action) ||
      (expectedProvider && provider.id !== expectedProvider) ||
      (expectedRevision && snapshot.revision !== expectedRevision)
    )
      throw new Error('Permission or Provider changed.');
    if (!connection) throw new Error('Kawaikara is not connected.');
    if (!readyAt) {
      if (!allowWake) throw new Error('Kawaikara disconnected. Retry the action.');
      if (!connection.launchUrl)
        throw new Error(
          connection.launchUrl === null
            ? 'Start the development app manually (pnpm dev), then retry. OS launch requires a packaged build.'
            : 'Reconnect once in extension settings to save the desktop launcher.',
        );
      const source = await api.tabs.get(tabId);
      const saved = (await api.storage.local.get(null)) as Record<
        string,
        PendingAction | undefined
      >;
      const pendingKeys = Object.keys(saved).filter((key) => key.startsWith('pending:'));
      for (const key of pendingKeys) {
        if ((saved[key]?.expires ?? 0) < Date.now() || saved[key]?.token !== connection.token)
          await api.storage.local.remove(key);
      }
      if (
        pendingKeys.filter(
          (key) =>
            (saved[key]?.expires ?? 0) >= Date.now() && saved[key]?.token === connection?.token,
        ).length >= 10
      )
        throw new Error('Finish or cancel pending Kawaikara requests first.');
      const id = crypto.randomUUID();
      const pending: PendingAction = {
        token: connection.token,
        action,
        url,
        tabId,
        sourceUrl: source.url,
        providerId: provider.id,
        revision: snapshot.revision,
        expires: Date.now() + 120000,
      };
      await api.storage.local.set({ [`pending:${id}`]: pending });
      try {
        await api.tabs.create({ url: api.runtime.getURL(`launch.html#${id}`), active: true });
      } catch (error) {
        await api.storage.local.remove(`pending:${id}`);
        throw error;
      }
      return { queued: true };
    }
    await verifyDocument?.();
    const result = await request<{ ok: boolean; clipboard?: string }>('invoke', {
      providerId: provider.id,
      action,
      url,
      revision: snapshot.revision,
      requestId: crypto.randomUUID(),
    });
    contract.validateWebExtensionBrowserResult(
      result,
      provider.actionDefinitions[action]?.clipboard === true,
    );
    if (result.clipboard !== undefined) {
      if (
        !provider.actionDefinitions[action]?.clipboard ||
        typeof result.clipboard !== 'string' ||
        result.clipboard.length > 16384
      )
        throw new Error('Undeclared browser effect.');
      await copyText(result.clipboard, tabId);
      return { copied: true };
    }
    return { copied: false };
  }

  interface PendingAction {
    token: string;
    action: WebExtensionAction;
    url: string;
    tabId: number;
    sourceUrl?: string;
    providerId: string;
    revision: string;
    expires: number;
  }
  const resuming = new Set<string>();
  async function resumePending(id: string, input: unknown) {
    const type = (input as { type?: string })?.type;
    if (!['launch-info', 'launch-resume', 'launch-cancel'].includes(type || ''))
      throw new Error('Invalid launch operation.');
    const key = `pending:${id}`;
    if (type === 'launch-cancel') {
      await api.storage.local.remove(key);
      return { cancelled: true };
    }
    if (resuming.has(id)) return { waiting: true };
    resuming.add(id);
    try {
      const pending = (await api.storage.local.get(key))[key] as PendingAction | undefined;
      if (
        !pending ||
        !connection ||
        pending.token !== connection.token ||
        pending.expires < Date.now()
      ) {
        await api.storage.local.remove(key);
        throw new Error('Request expired or connection changed. Retry from the original page.');
      }
      if (type === 'launch-info') return { launchUrl: connection.launchUrl };
      await synchronize();
      if (!connection || connection.token !== pending.token)
        throw new Error('Connection changed. Retry the action.');
      if (!readyAt) return { waiting: true };
      // Consume before dispatch: a lost response must never replay an action.
      await api.storage.local.remove(key);
      const source = await api.tabs.get(pending.tabId);
      if (source.url !== pending.sourceUrl)
        throw new Error('Original page navigated. Retry the action.');
      await invoke(
        pending.action,
        pending.url,
        pending.tabId,
        pending.providerId,
        pending.revision,
        false,
      );
      return { completed: true };
    } finally {
      resuming.delete(id);
    }
  }

  const ready = (async () => {
    await api.storage.local.setAccessLevel?.({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    const stored = await api.storage.local.get([
      'connection',
      'catalogCache',
      'developmentConnection',
      'language',
      'instanceId',
      'pendingDisconnects',
    ]);
    await api.storage.local.remove('localGrants');
    language =
      stored.language === 'en' || stored.language === 'ko' || stored.language === 'ja'
        ? stored.language
        : 'system';
    setLocale(language);
    instanceId =
      typeof stored.instanceId === 'string' && /^[a-f0-9-]{36}$/.test(stored.instanceId)
        ? stored.instanceId
        : crypto.randomUUID();
    await api.storage.local.set({ instanceId });
    developmentConnection =
      typeof stored.developmentConnection === 'boolean'
        ? stored.developmentConnection
        : development;
    if (Array.isArray(stored.pendingDisconnects)) {
      pendingDisconnects = stored.pendingDisconnects.flatMap((entry) => {
        try {
          return [requireConnection(entry)];
        } catch {
          return [];
        }
      });
    }
    if (stored.connection) {
      const savedConnection = requireConnection(stored.connection);
      if (!pendingDisconnects.some((entry) => entry.token === savedConnection.token))
        connection = savedConnection;
      else await api.storage.local.remove(['connection', 'catalogCache']);
    }
    const cached = stored.catalogCache as
      { token?: string; savedAt: number; catalog: Catalog } | undefined;
    if (
      connection &&
      cached?.token === connection.token &&
      Number.isFinite(cached.savedAt) &&
      Date.now() >= cached.savedAt
    ) {
      try {
        contract.validateWebExtensionProviders(cached.catalog.providers);
        if (
          cached.catalog.version === 2 &&
          /^[a-f0-9]{64}$/.test(cached.catalog.revision) &&
          Array.isArray(cached.catalog.grants)
        )
          snapshot = cached.catalog;
      } catch {
        /* Invalid cache never prevents online recovery. */
      }
    }
    await synchronize();
    await api.alarms.create('kawaikara-sync', { periodInMinutes: 0.5 });
    loaded = true;
  })().catch(async (error) => {
    startupError = errorMessage(error);
    await showStatus();
  });

  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'kawaikara-sync') void ready.then(synchronize);
  });
  api.runtime.onStartup.addListener(() => {
    void ready.then(synchronize);
  });
  api.runtime.onInstalled.addListener((details) => {
    void ready.then(async () => {
      await synchronize();
      if (details.reason === 'install') await api.runtime.openOptionsPage();
    });
  });
  api.permissions.onRemoved.addListener(() => {
    applyKey = '';
    void ready.then(synchronize);
  });
  api.permissions.onAdded.addListener(() => {
    applyKey = '';
    void ready.then(synchronize);
  });
  api.action.onClicked.addListener((tab) => {
    void ready
      .then(async () => {
        const provider = providerFor(tab.url || '');
        const action = provider?.toolbarAction;
        if (!action || !provider.actions.includes(action)) {
          await api.runtime.openOptionsPage();
          return;
        }
        await invoke(action, tab.url, tab.id, provider.id);
      })
      .catch((error) => {
        lastError = errorMessage(error);
        void api.runtime.openOptionsPage();
      });
  });
  api.contextMenus.onClicked.addListener((info, tab) => {
    void ready
      .then(async () => {
        const route = menuRoutes.get(String(info.menuItemId));
        if (!route || (info.frameId !== undefined && info.frameId !== 0)) return;
        await invoke(
          route.item.action,
          route.item.contexts.includes('link') ? info.linkUrl : info.pageUrl || tab?.url,
          tab?.id,
          route.providerId,
          route.revision,
        );
      })
      .catch((error) => {
        lastError = errorMessage(error);
        void api.runtime.openOptionsPage();
      });
  });

  api.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (sender.id !== api.runtime.id) return false;
    if (
      ['desktop-connect', 'desktop-connect-mode'].includes((input as { type?: string })?.type || '')
    ) {
      if (
        sender.frameId !== 0 ||
        typeof sender.tab?.id !== 'number' ||
        typeof sender.url !== 'string'
      )
        return false;
      const match =
        /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/extension-connect#([a-f0-9]{64})(?::(development|production))?$/.exec(
          sender.url,
        );
      if (!match) return false;
      if ((input as { type: string }).type === 'desktop-connect-mode') {
        void ready.then(
          () => respond({ result: { developmentConnection, language } }),
          (error) => respond({ error: errorMessage(error) }),
        );
        return true;
      }
      const sourceUrl = sender.url;
      const sourceTabId = sender.tab.id;
      void ready
        .then(async () => {
          if ((match[3] === 'development') !== developmentConnection)
            throw new Error('Connection mode mismatch.');
          const tab = await api.tabs.get(sourceTabId);
          if (tab.url !== sourceUrl)
            throw new Error('Connection page changed. Retry from Kawaikara.');
          const setup = requireConnection({
            version: 1,
            url: `http://127.0.0.1:${match[1]}`,
            token: '0'.repeat(64),
          });
          // The app-issued fragment is the one-use authorization. Never accept a URL or token from page messages.
          const result = await request(
            'connect',
            {
              adapterVersion: 2,
              handoff: match[2],
              extension: await extensionInfo(developmentConnection),
            },
            setup,
          );
          if (result?.adapterVersion !== 2) throw new Error('Update Kawaikara.');
          if (syncTask) await syncTask;
          connection = requireConnection({
            ...setup,
            token: result.token,
            launchUrl: result.launchUrl,
          });
          readyAt = 0;
          snapshot = { version: 2, revision: '', providers: [], grants: [] };
          await api.storage.local.remove('catalogCache');
          await api.storage.local.set({ connection });
          await synchronize();
          // Reuse the onboarding tab: no second settings tab or abandoned success page.
          await api.tabs.update(sourceTabId, {
            url: api.runtime.getURL('options.html'),
            active: true,
          });
          return { connected: true };
        })
        .then(
          (result) => respond({ result }),
          (error) => respond({ error: errorMessage(error) }),
        );
      return true;
    }
    const launchPrefix = api.runtime.getURL('launch.html#');
    if (sender.url?.startsWith(launchPrefix)) {
      const id = sender.url.slice(launchPrefix.length);
      if (!/^[a-f0-9-]{36}$/.test(id)) return false;
      void ready
        .then(() => resumePending(id, input))
        .then(
          (result) => respond({ result }),
          (error) => respond({ error: errorMessage(error) }),
        );
      return true;
    }
    const options = sender.url === api.runtime.getURL('options.html');
    const content =
      sender.frameId === 0 && Number.isInteger(sender.tab?.id) && typeof sender.url === 'string';
    if (!options && !content) return false;
    void ready
      .then(async () => {
        const data = parseMessage(input);
        if (options) {
          if (data.type === 'language') {
            language = data.language;
            setLocale(language);
            await api.storage.local.set({ language });
          } else if (data.type === 'development-mode') {
            developmentConnection = data.enabled;
            await api.storage.local.set({ developmentConnection });
          } else if (data.type === 'configure') {
            await synchronize();
            if (!connection || !readyAt || data.revision !== snapshot.revision)
              throw new Error('Catalog changed. Refresh and review your changes.');
            for (const change of data.changes) {
              const provider = snapshot.providers.find((p) => p.id === change.providerId);
              if (!provider) throw new Error('Provider removed.');
              contract.webExtensionSettings(provider, change.settings);
              if (
                change.enabled &&
                !(await api.permissions.contains({ origins: patterns(provider) }))
              )
                throw new Error('Site permission is required.');
            }
            await request('configure', { revision: data.revision, changes: data.changes });
          } else if (data.type === 'connect') {
            const setup = data.code
              ? requireConnection(JSON.parse(data.code))
              : await discover(false, developmentConnection);
            const result = await request(
              data.code ? 'pair' : 'connect',
              { adapterVersion: 2, extension: await extensionInfo(developmentConnection) },
              setup,
            );
            if (result?.adapterVersion !== 2)
              throw new Error('Update Kawaikara to support adapter version 2.');
            disconnectedByApp = false;
            connection = requireConnection({
              ...setup,
              token: result?.token,
              launchUrl: result?.launchUrl,
            });
            readyAt = 0;
            snapshot = { version: 2, revision: '', providers: [], grants: [] };
            await api.storage.local.set({ connection });
          } else if (data.type === 'wake') {
            await synchronize();
            if (!connection || !readyAt) throw new Error('Start the paired Kawaikara app first.');
            await request('wake', {});
          } else if (data.type === 'disconnect') {
            // Finish any in-flight catalog update before clearing local authority.
            if (syncTask) await syncTask;
            if (
              connection &&
              !pendingDisconnects.some((entry) => entry.token === connection!.token)
            )
              pendingDisconnects.push(connection);
            // Durable intent and inactive state are saved together before removing menus.
            await api.storage.local.set({
              pendingDisconnects,
              connection: null,
              catalogCache: null,
            });
            connection = undefined;
            readyAt = 0;
            disconnectedByApp = false;
            snapshot = { version: 2, revision: '', providers: [], grants: [] };
            await api.storage.local.remove(['connection', 'catalogCache']);
            const saved = await api.storage.local.get(null);
            for (const key of Object.keys(saved))
              if (key.startsWith('pending:')) await api.storage.local.remove(key);
            await apply();
            await showStatus();
          } else if (
            data.type === 'enable' ||
            data.type === 'revoke' ||
            data.type === 'settings-update'
          ) {
            await synchronize();
            if (!connection || !readyAt) throw new Error('Connect Kawaikara first.');
            const provider = snapshot.providers.find((entry) => entry.id === data.providerId);
            if (!provider) throw new Error('Provider removed.');
            if (data.type === 'enable') {
              if (!(await api.permissions.contains({ origins: patterns(provider) })))
                throw new Error('Site permission is required.');
              await request('grant', {
                providerId: provider.id,
                revision: snapshot.revision,
                actions: provider.actions,
                settings: contract.webExtensionSettings(provider, data.settings || {}),
              });
            } else if (data.type === 'settings-update') {
              const settings = contract.webExtensionSettings(provider, data.settings);
              await request('settings', {
                providerId: provider.id,
                revision: snapshot.revision,
                settings,
              });
            } else await request('revoke', { providerId: provider.id });
          } else if (data.type !== 'settings' && data.type !== 'probe')
            throw new Error('Unknown settings operation.');
          // Local UI preferences must not depend on bridge availability or content-script refresh.
          if (data.type !== 'language' && data.type !== 'development-mode') await synchronize();
          let desktopAvailable = Boolean(readyAt);
          if (data.type === 'probe' && !connection) {
            try {
              await discover();
              desktopAvailable = true;
            } catch {
              /* Not running yet. */
            }
          }
          return {
            uiVersion: 1,
            developmentConnection,
            language,
            disconnectedByApp,
            pendingDisconnectCount: pendingDisconnects.length,
            desktop: snapshot.desktop,
            bridgeUrl: connection?.url,
            desktopAvailable,
            launchUrl: connection?.launchUrl,
            configured: snapshot.providers.flatMap((provider) => {
              const grant = snapshot.grants.find(
                (g) =>
                  g.id === provider.id && g.key === contract.webExtensionPermissionKey(provider),
              );
              return grant
                ? [{ ...provider, values: contract.webExtensionSettings(provider, grant.settings) }]
                : [];
            }),
            loaded,
            loadError: startupError,
            connected: Boolean(connection),
            online: Boolean(readyAt),
            error: lastError,
            providers: snapshot.providers,
            active,
            revision: snapshot.revision,
          };
        }
        if (data.type === 'provider-state') {
          await synchronize();
          // Bind to browser-supplied sender URL, never a page-supplied URL/Provider claim.
          return {
            providers: active.filter((entry) =>
              contract.resolveWebExtensionProvider([entry], sender.url || ''),
            ),
            revision: snapshot.revision,
            expires: Date.now() + 60000,
          };
        }
        if (data.type === 'provider-action') {
          if (typeof sender.tab?.id !== 'number' || typeof sender.url !== 'string')
            throw new Error('Invalid content sender.');
          const tabId = sender.tab.id;
          const targetUrl = data.url || sender.url;
          const verifyDocument = async () => {
            if (data.documentKey) {
              // sender.url can retain the document's initial URL after history.pushState.
              // Ask the live top-frame renderer instead of trusting a page-supplied URL
              // or tabs.get's asynchronously updated address.
              const current = await api.tabs
                .sendMessage(tabId, { type: 'kawaikara-document' }, { frameId: 0 })
                .catch(() => null);
              if (
                !current ||
                current.documentKey !== data.documentKey ||
                current.url !== targetUrl ||
                new URL(targetUrl).origin !== new URL(sender.url!).origin
              )
                throw new Error('Document navigated.');
            } else {
              const tab = await api.tabs.get(tabId);
              if (tab.url !== sender.url) throw new Error('Document navigated.');
            }
          };
          await verifyDocument();
          return await invoke(
            data.action,
            targetUrl,
            tabId,
            data.providerId,
            data.revision,
            true,
            verifyDocument,
          );
        }
        throw new Error('Unknown content operation.');
      })
      .then(
        (result) => respond({ result }),
        (error) => respond({ error: errorMessage(error) }),
      );
    return true;
  });
})(globalThis.chrome, KawaikaraContract);
