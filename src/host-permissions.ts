import type { WebExtensionProvider } from './provider-contract';

/** Keep each requested scheme within one manifest optional_host_permissions entry. */
export function providerHostPatterns(provider: Pick<WebExtensionProvider, 'domains'>): string[] {
  return provider.domains.flatMap((host) => [`http://*.${host}/*`, `https://*.${host}/*`]);
}
