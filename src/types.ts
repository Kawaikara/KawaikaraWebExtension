export interface DesktopInfo {
  name: string;
  version: string;
  channel: string;
  runtime: string;
  appPath: string;
  profileId: string;
}
import type { WebExtensionAction, WebExtensionProvider } from './provider-contract';
export interface Connection {
  version: 1;
  url: string;
  token: string;
  /** OS protocol handler learned during approved pairing; never contains credentials. */
  launchUrl?: string | null;
}
export interface Grant {
  id: string;
  key: string;
  actions: WebExtensionAction[];
  settings: Record<string, boolean>;
}
export interface ActiveProvider extends WebExtensionProvider {
  values: Record<string, boolean>;
}
export interface Catalog {
  desktop?: DesktopInfo;
  launchUrl?: string | null;
  version: 2;
  revision: string;
  providers: WebExtensionProvider[];
  grants: Grant[];
}
export interface ProviderChange {
  providerId: string;
  enabled: boolean;
  settings: Record<string, boolean>;
}
export interface SettingsState {
  developmentConnection: boolean;
  language: import('./i18n').Locale;
  disconnectedByApp?: boolean;
  pendingDisconnectCount?: number;
  desktop?: DesktopInfo;
  bridgeUrl?: string;
  uiVersion: 1;
  loaded: boolean;
  loadError: string;
  connected: boolean;
  online: boolean;
  desktopAvailable: boolean;
  launchUrl?: string | null;
  configured: ActiveProvider[];
  error: string;
  providers: WebExtensionProvider[];
  active: ActiveProvider[];
  revision: string;
}
export interface ContentState {
  providers: ActiveProvider[];
  revision: string;
  expires: number;
}
export type Message =
  | { type: 'settings' | 'disconnect' | 'provider-state' | 'probe' | 'wake' }
  | { type: 'connect'; code?: string; development?: boolean }
  | { type: 'language'; language: import('./i18n').Locale }
  | { type: 'development-mode'; enabled: boolean }
  | { type: 'configure'; revision: string; changes: ProviderChange[] }
  | { type: 'enable'; providerId: string; settings?: Record<string, boolean> }
  | { type: 'settings-update'; providerId: string; settings: Record<string, boolean> }
  | { type: 'revoke'; providerId: string }
  | {
      type: 'provider-action';
      documentKey?: string;
      url?: string;
      providerId: string;
      action: WebExtensionAction;
      revision: string;
    };
export interface Reply<T> {
  result?: T;
  error?: string;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function parseMessage(value: unknown): Message {
  if (!value || typeof value !== 'object' || !('type' in value))
    throw new Error('Invalid message.');
  const data = value as Record<string, unknown>;
  if (
    data.type === 'wake' ||
    data.type === 'probe' ||
    data.type === 'settings' ||
    data.type === 'disconnect' ||
    data.type === 'provider-state'
  )
    return { type: data.type };
  if (
    data.type === 'connect' &&
    (data.code === undefined || (typeof data.code === 'string' && data.code.length <= 4096))
  )
    return {
      type: 'connect',
      code: data.code as string | undefined,
      development: data.development === true,
    };
  if (data.type === 'language' && ['system', 'en', 'ko', 'ja'].includes(String(data.language)))
    return { type: 'language', language: data.language as import('./i18n').Locale };
  if (data.type === 'development-mode' && typeof data.enabled === 'boolean')
    return { type: 'development-mode', enabled: data.enabled };
  if (
    data.type === 'configure' &&
    typeof data.revision === 'string' &&
    Array.isArray(data.changes) &&
    data.changes.length &&
    data.changes.every(
      (change) =>
        change &&
        typeof change.providerId === 'string' &&
        change.providerId.length <= 160 &&
        typeof change.enabled === 'boolean' &&
        change.settings &&
        typeof change.settings === 'object' &&
        !Array.isArray(change.settings) &&
        Object.values(change.settings).every((value) => typeof value === 'boolean'),
    )
  ) {
    return {
      type: 'configure',
      revision: data.revision,
      changes: data.changes as ProviderChange[],
    };
  }
  if (typeof data.providerId !== 'string' || data.providerId.length > 160)
    throw new Error('Invalid Provider.');
  if (data.type === 'revoke') return { type: 'revoke', providerId: data.providerId };
  if (
    data.type === 'enable' &&
    (data.settings === undefined ||
      (data.settings &&
        typeof data.settings === 'object' &&
        !Array.isArray(data.settings) &&
        Object.values(data.settings).every((value) => typeof value === 'boolean')))
  )
    return {
      type: 'enable',
      providerId: data.providerId,
      settings: data.settings as Record<string, boolean> | undefined,
    };
  if (
    data.type === 'settings-update' &&
    data.settings &&
    typeof data.settings === 'object' &&
    !Array.isArray(data.settings) &&
    Object.values(data.settings).every((value) => typeof value === 'boolean')
  )
    return {
      type: 'settings-update',
      providerId: data.providerId,
      settings: data.settings as Record<string, boolean>,
    };
  if (
    data.type === 'provider-action' &&
    typeof data.action === 'string' &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(data.action) &&
    typeof data.revision === 'string' &&
    ((data.documentKey === undefined && data.url === undefined) ||
      (typeof data.documentKey === 'string' &&
        /^[a-f0-9-]{36}$/.test(data.documentKey) &&
        typeof data.url === 'string' &&
        data.url.length <= 16384))
  )
    return {
      type: 'provider-action',
      providerId: data.providerId,
      action: data.action,
      revision: data.revision,
      documentKey: data.documentKey as string | undefined,
      url: data.url as string | undefined,
    };
  throw new Error('Unsupported message.');
}
