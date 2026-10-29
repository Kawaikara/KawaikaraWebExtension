import { AnimatePresence, motion } from 'motion/react';
import { development } from './build-info';
import { t, setLocale, type Locale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Button, Input, Panel, Switch } from '@kawaikara/kawai-ui';
import '@kawaikara/kawai-ui/styles.css';
import './options.css';
import type { Message, Reply, SettingsState, ProviderChange } from './types';
import { errorMessage } from './types';
import { providerHostPatterns } from './host-permissions';
import {
  type WebExtensionProvider,
  webExtensionSettings,
  webExtensionItemTitle,
} from './provider-contract';
const api = chrome;
async function request(message: Message): Promise<SettingsState> {
  const reply: Reply<SettingsState> = await api.runtime.sendMessage(message);
  if (reply?.error) {
    if (
      message.type === 'language' &&
      /Invalid Provider|Unsupported message|Unknown settings operation/.test(reply.error)
    )
      throw new Error(
        'The extension background worker is outdated. Reload the extension on the browser extensions page, close this settings tab, and open settings again.',
      );
    throw new Error(reply.error);
  }
  const state = reply?.result;
  if (
    !state ||
    state.uiVersion !== 1 ||
    !Array.isArray(state.providers) ||
    !Array.isArray(state.configured) ||
    !Array.isArray(state.active)
  )
    throw new Error('Reload the extension, close old settings tabs, then reopen settings.');
  setLocale(state.language || 'system');
  document.documentElement.lang =
    state.language && state.language !== 'system'
      ? state.language
      : api.i18n.getUILanguage?.() || 'en';
  return state;
}
function App() {
  const [state, setState] = useState<SettingsState>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem('providerView') === 'compact');
  const [selectedProvider, setSelectedProvider] = useState<string>();
  const providerDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selectedProvider) providerDialog.current?.showModal();
  }, [selectedProvider]);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ProviderChange>>({});
  const draftRevision = useRef('');
  const devDialog = useRef<HTMLDialogElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const revocationShown = useRef(false);
  const infoButton = useRef<HTMLButtonElement>(null);
  async function run(work: () => Promise<SettingsState>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    setNotice('');
    try {
      setState(await work());
    } catch (error) {
      setFailed(true);
      setNotice(errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(() => request({ type: 'settings' }));
    let active = true;
    const refresh = () => {
      if (!locked.current)
        void request({ type: 'settings' })
          .then((next) => {
            if (!active || locked.current) return;
            setState(next);
            if (next.disconnectedByApp && !revocationShown.current) {
              revocationShown.current = true;
              setDrafts({});
              setNotice(t('disconnectedByApp'));
            }
            if (next.connected) revocationShown.current = false;
          })
          .catch(() => undefined);
    };
    const timer = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (!notice || failed) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice, failed]);
  function launch(current: SettingsState) {
    if (current.launchUrl !== 'kawaikara://bridge/wake')
      throw new Error('Start Kawaikara manually. For a development app, run pnpm dev and retry.');
    const link = document.createElement('a');
    link.href = current.launchUrl;
    link.click();
  }
  async function ensureDesktop() {
    let current = await request({ type: 'probe' });
    if (current.desktopAvailable) return current;
    launch(current);
    setNotice(t('waitingForApp'));
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = await request({ type: 'probe' });
      if (current.desktopAvailable) {
        setNotice('');
        return current;
      }
    }
    throw new Error('Kawaikara did not connect; changes were not saved.');
  }
  function stage(change: ProviderChange) {
    if (!state || locked.current) return;
    if (!Object.keys(drafts).length) draftRevision.current = state.revision;
    const saved = state.configured.find((p) => p.id === change.providerId);
    const same =
      Boolean(saved) === change.enabled &&
      (!change.enabled ||
        Object.entries(change.settings).every(([key, value]) => saved?.values[key] === value));
    setDrafts((previous) => {
      const next = { ...previous };
      if (same) delete next[change.providerId];
      else next[change.providerId] = change;
      return next;
    });
  }
  function stageAll(enabled: boolean) {
    if (!state || locked.current) return;
    if (!Object.keys(drafts).length) draftRevision.current = state.revision;
    const next = { ...drafts };
    for (const provider of state.providers) {
      const saved = state.configured.find((p) => p.id === provider.id);
      const settings =
        next[provider.id]?.settings ?? saved?.values ?? webExtensionSettings(provider, {});
      if (
        Boolean(saved) === enabled &&
        (!enabled || Object.entries(settings).every(([key, value]) => saved?.values[key] === value))
      )
        delete next[provider.id];
      else next[provider.id] = { providerId: provider.id, enabled, settings };
    }
    setDrafts(next);
  }
  function applyDrafts() {
    if (!state || locked.current) return;
    const changes = Object.values(drafts);
    // Start the browser permission request inside this click, before any await.
    const origins = [
      ...new Set(
        changes
          .filter((c) => c.enabled)
          .flatMap((c) => {
            const provider = state.providers.find((p) => p.id === c.providerId);
            return provider ? providerHostPatterns(provider) : [];
          }),
      ),
    ];
    const permission = origins.length
      ? api.permissions.request({ origins })
      : Promise.resolve(true);
    void run(async () => {
      if (!(await permission))
        throw new Error('Site access was denied. No Provider changes were applied.');
      const current = await ensureDesktop();
      if (current.revision !== draftRevision.current)
        throw new Error('Catalog changed. Cancel these changes and review the latest settings.');
      const next = await request({ type: 'configure', revision: draftRevision.current, changes });
      setDrafts({});
      return next;
    });
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  const connectionLabel = !state
    ? t('checking')
    : state?.online
      ? t('connected')
      : state?.connected
        ? t('appOffline')
        : t('notConnected');
  const tone =
    !state || (state?.connected && !state.online)
      ? 'warning'
      : state?.online
        ? 'success'
        : 'danger';
  const filtered = (state?.providers || []).filter((p) =>
    `${p.title} ${p.id} ${p.domains.join(' ')}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const closeInfo = () => {
    dialog.current?.close();
    infoButton.current?.focus();
  };
  const providerLanguage =
    state?.language && state.language !== 'system' ? state.language : api.i18n.getUILanguage();
  const renderProvider = (provider: WebExtensionProvider, small = false) => {
    const saved = state?.configured.find((p) => p.id === provider.id);
    const change = drafts[provider.id];
    const enabled = change ? (change.enabled ? { values: change.settings } : undefined) : saved;
    return (
      <Panel
        key={provider.id}
        padding="lg"
        radius="lg"
        className={`provider-card ${small ? 'provider-card-compact' : ''}`}
      >
        <div
          className="section-row"
          onClick={small ? () => setSelectedProvider(provider.id) : undefined}
        >
          <div className="provider-identity">
            {provider.icon && (
              <img
                className="provider-icon"
                src={provider.icon}
                alt=""
                draggable={false}
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.style.visibility = 'hidden';
                }}
              />
            )}
            <div>
              <h3>{provider.title}</h3>
              <small>{provider.id}</small>
            </div>
          </div>
          <span onClick={(event) => event.stopPropagation()}>
            <Switch
              label={t('enable')}
              checked={!!enabled}
              disabled={busy}
              aria-label={`${provider.title} WebExtension`}
              onCheckedChange={(on) =>
                stage({
                  providerId: provider.id,
                  enabled: on,
                  settings: change?.settings ?? saved?.values ?? webExtensionSettings(provider, {}),
                })
              }
            />
          </span>
        </div>
        {small ? (
          <button
            className="provider-card-open"
            aria-label={`${provider.title} · ${t('providerDetails')}`}
            onClick={() => setSelectedProvider(provider.id)}
          >
            <span className="compact-summary">
              {Object.values(provider.actionDefinitions)
                .map((action) => webExtensionItemTitle(action, providerLanguage))
                .join(' · ')}
            </span>
            <span className="compact-open-label">{t('providerDetails')} ↗</span>
          </button>
        ) : (
          <>
            <div className="permission-group">
              <span className="field-label">{t('siteAccess')}</span>
              <div className="tags">
                {provider.domains.map((domain) => (
                  <Badge key={domain}>{domain}</Badge>
                ))}
              </div>
            </div>
            <div className="permission-group">
              <span className="field-label">{t('requestedCapabilities')}</span>
              <div className="tags">
                {Object.entries(provider.actionDefinitions).map(([id, action]) => (
                  <Badge key={id} tone="primary">
                    {webExtensionItemTitle(action, providerLanguage)}
                  </Badge>
                ))}
                {provider.domActions?.length ? (
                  <Badge tone="warning">{t('pageInjection')}</Badge>
                ) : null}
                {Object.values(provider.actionDefinitions).some((a) => a.clipboard) && (
                  <Badge tone="warning">{t('clipboardWrite')}</Badge>
                )}
              </div>
            </div>
            {(provider.settings || []).length > 0 && (
              <div className="provider-settings">
                {provider.settings!.map((setting) => (
                  <Switch
                    key={setting.id}
                    label={webExtensionItemTitle(setting, providerLanguage)}
                    checked={enabled?.values[setting.id] ?? setting.defaultValue}
                    disabled={busy || !enabled}
                    onCheckedChange={(value) =>
                      stage({
                        providerId: provider.id,
                        enabled: true,
                        settings: { ...enabled?.values, [setting.id]: value },
                      })
                    }
                  />
                ))}
              </div>
            )}
            <div className="card-footer">
              <Badge dot tone={enabled ? (state?.online ? 'success' : 'warning') : 'neutral'}>
                {enabled ? (state?.online ? t('enabled') : t('cached')) : t('disabled')}
              </Badge>
              <span>{change ? t('pendingChanges') : !enabled ? t('enableToEdit') : ''}</span>
            </div>
          </>
        )}
      </Panel>
    );
  };
  return (
    <main className="preferences">
      <header className="page-header">
        <img src="icons/icon-48.png" width="48" height="48" alt="" />
        <div>
          <h1>Kawaikara WebExtension {development && <Badge>Dev</Badge>}</h1>
          <p>{t('preferencesDescription')}</p>
        </div>
        <label className="language-picker">
          {t('language')}
          <select
            aria-label={t('language')}
            value={state?.language || 'system'}
            onChange={(e) =>
              void run(() => request({ type: 'language', language: e.target.value as Locale }))
            }
          >
            <option value="system">{t('systemLanguage')}</option>
            <option value="en">English</option>
            <option value="ko">한국어</option>
            <option value="ja">日本語</option>
          </select>
        </label>
      </header>
      <Panel padding="lg" radius="lg" className="connection-panel">
        <div className="section-row">
          <div>
            <span className="eyebrow">{t('connectionSection')}</span>
            <h2>{t('appConnection')}</h2>
          </div>
          <Badge dot tone={tone} role="status">
            {t('connectionStatus')} · {connectionLabel}
          </Badge>
        </div>
        <p className="muted">
          {state?.online
            ? t('synchronizedDescription')
            : state?.connected
              ? t('cachedDescription')
              : t('connectDescription')}
        </p>
        <div className="actions">
          {state?.connected ? (
            <>
              <Button
                id="launch"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const current = await request({ type: 'probe' });
                    if (current.online) return request({ type: 'wake' });
                    launch(current);
                    return current;
                  })
                }
              >
                {state.online ? t('showApp') : t('openApp')}
              </Button>
              <Button
                id="disconnect"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await request({ type: 'disconnect' });
                    setDrafts({});
                    return next;
                  })
                }
              >
                {t('disconnect')}
              </Button>
              <Button
                ref={infoButton}
                variant="secondary"
                disabled={!state.connected}
                onClick={() => dialog.current?.showModal()}
              >
                {t('connectedAppDetails')}
              </Button>
            </>
          ) : (
            <Button
              id="connect"
              disabled={busy || !state}
              onClick={() =>
                void run(async () => {
                  return request({ type: 'connect' });
                })
              }
            >
              {t('connect')}
            </Button>
          )}
          <Button
            id="refresh"
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => request({ type: 'settings' }))}
          >
            {t('refresh')}
          </Button>
        </div>
        {!state?.connected && (
          <div className="manual">
            <Button
              variant="secondary"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              {t('advancedConnection')}
            </Button>
            <AnimatePresence initial={false}>
              {advancedOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="advanced-body">
                    <Switch
                      label={t('useDevelopmentApp')}
                      checked={state?.developmentConnection ?? development}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        value
                          ? devDialog.current?.showModal()
                          : void run(() => request({ type: 'development-mode', enabled: false }))
                      }
                    />
                    {(state?.developmentConnection ?? development) && (
                      <p>{t('startDevelopmentApp')}</p>
                    )}
                    <label htmlFor="code">{t('connectionCode')}</label>
                    <textarea
                      id="code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      disabled={busy || !code.trim()}
                      onClick={() => {
                        const value = code.trim();
                        setCode('');
                        void run(() => request({ type: 'connect', code: value }));
                      }}
                    >
                      {t('connectWithCode')}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Panel>
      {!!state?.pendingDisconnectCount && (
        <p className="notice" role="status">
          {t('disconnectPending')}
        </p>
      )}
      {(notice || state?.loadError) && (
        <div
          className={`notice ${failed || state?.loadError ? 'error' : ''}`}
          role={failed ? 'alert' : 'status'}
        >
          {notice || state?.loadError}
        </div>
      )}
      <section aria-label={t('providersSection')}>
        <div className="provider-heading">
          <div>
            <span className="eyebrow">{t('providersSection')}</span>
            <h2>
              {t('browserFeatures')} <span className="count">{state?.providers.length || 0}</span>
            </h2>
          </div>
          <Input
            id="provider-search"
            type="search"
            label={t('searchProviders')}
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="muted">{t('reviewPermissions')}</p>
        <div className="actions bulk-actions">
          <Button disabled={busy || !state?.connected} onClick={() => stageAll(true)}>
            {t('enableAll')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !state?.connected}
            onClick={() => stageAll(false)}
          >
            {t('disableAll')}
          </Button>
          <div className="view-modes" role="group" aria-label={t('providerView')}>
            {[false, true].map((value) => (
              <Button
                key={String(value)}
                variant="secondary"
                aria-label={t(value ? 'compactView' : 'expandedView')}
                title={t(value ? 'compactView' : 'expandedView')}
                aria-pressed={compact === value}
                onClick={() => {
                  setCompact(value);
                  localStorage.setItem('providerView', value ? 'compact' : 'expanded');
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  {value ? (
                    <>
                      <rect x="2" y="2" width="6" height="6" rx="1" />
                      <rect x="12" y="2" width="6" height="6" rx="1" />
                      <rect x="2" y="12" width="6" height="6" rx="1" />
                      <rect x="12" y="12" width="6" height="6" rx="1" />
                    </>
                  ) : (
                    <rect x="2" y="2" width="16" height="16" rx="2" />
                  )}
                </svg>
              </Button>
            ))}
          </div>
        </div>
        <div id="providers" className={`provider-grid ${compact ? 'compact-grid' : ''}`}>
          {filtered.map((provider) => renderProvider(provider, compact))}
        </div>
        {!filtered.length && (
          <Panel padding="lg" className="empty">
            {query
              ? t('noMatchingProviders')
              : state?.connected
                ? t('noFeatures')
                : t('connectToLoad')}
          </Panel>
        )}
      </section>
      <AnimatePresence>
        {Object.keys(drafts).length > 0 && (
          <motion.aside
            className="draft-footer"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            aria-label={t('pendingChanges')}
          >
            <div>
              <strong>
                {t('pendingChanges')} · {Object.keys(drafts).length}
              </strong>
              <p>{t('applyDescription')}</p>
            </div>
            <Button variant="secondary" disabled={busy} onClick={() => setDrafts({})}>
              {t('cancelChanges')}
            </Button>
            <Button disabled={busy} onClick={applyDrafts}>
              {busy ? t('waitingForApproval') : t('applyChanges')}
            </Button>
          </motion.aside>
        )}
      </AnimatePresence>
      <dialog
        ref={providerDialog}
        className="provider-dialog"
        aria-label={t('providerDetails')}
        onClose={() => setSelectedProvider(undefined)}
      >
        <div className="provider-dialog-close">
          <Button
            variant="ghost"
            className="popup-close"
            aria-label={t('close')}
            onClick={() => providerDialog.current?.close()}
          >
            ×
          </Button>
        </div>
        {state?.providers
          .filter((provider) => provider.id === selectedProvider)
          .map((provider) => renderProvider(provider))}
      </dialog>
      <dialog ref={devDialog} aria-labelledby="dev-mode-title">
        <h2 id="dev-mode-title">{t('useDevelopmentApp')}</h2>
        <p>{t('developmentConfirm')}</p>
        <p>{t('startDevelopmentApp')}</p>
        <div className="actions">
          <Button variant="secondary" onClick={() => devDialog.current?.close()}>
            {t('cancelChanges')}
          </Button>
          <Button
            onClick={() => {
              devDialog.current?.close();
              void run(() => request({ type: 'development-mode', enabled: true }));
            }}
          >
            {t('enable')}
          </Button>
        </div>
      </dialog>
      <footer>
        Kawaikara WebExtension{development ? ' Dev' : ''} · {api.runtime.getManifest().version}
      </footer>
      <dialog
        ref={dialog}
        onClose={() => infoButton.current?.focus()}
        aria-labelledby="desktop-title"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.target === event.currentTarget &&
            (event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom)
          )
            event.currentTarget.close();
        }}
      >
        <div className="section-row">
          <h2 id="desktop-title">{t('connectedApp')}</h2>
          <Button
            variant="ghost"
            className="popup-close"
            aria-label={t('close')}
            onClick={closeInfo}
          >
            ×
          </Button>
        </div>
        <Badge dot tone={tone}>
          {connectionLabel}
        </Badge>
        {!state?.online && <p className="muted">{t('lastConnection')}</p>}
        <dl>
          {[
            [t('appName'), state?.desktop?.name],
            [t('version'), state?.desktop?.version],
            [t('channel'), state?.desktop?.channel],
            [t('runtime'), state?.desktop?.runtime],
            [t('appLocation'), state?.desktop?.appPath],
            [t('profileId'), state?.desktop?.profileId],
            [t('bridgeAddress'), state?.bridgeUrl],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || t('unavailableDetails')}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{t('identifyInstallation')}</p>
      </dialog>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
