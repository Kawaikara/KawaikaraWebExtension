/** Compile-time channel: runtime messages cannot change this identity. */
declare const __KAWAIKARA_DEVELOPMENT__: boolean;
export const development =
  typeof __KAWAIKARA_DEVELOPMENT__ !== 'undefined' && __KAWAIKARA_DEVELOPMENT__;
export async function extensionInfo(connectionMode = development) {
  const manifest = chrome.runtime.getManifest?.();
  const platform = await chrome.runtime.getPlatformInfo?.().catch(() => undefined);
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const ua = nav?.userAgent ?? '';
  const browserRuntime = chrome.runtime as typeof chrome.runtime & {
    getBrowserInfo?: () => Promise<{ version: string }>;
  };
  const browserInfo = await browserRuntime.getBrowserInfo?.().catch(() => undefined);
  const browserVersion = /(?:Firefox|Chrome)\/([\d.]+)/.exec(ua)?.[1];
  const clientHints = nav as Navigator & {
    userAgentData?: { getHighEntropyValues(keys: string[]): Promise<Record<string, unknown>> };
  };
  const hints = await clientHints?.userAgentData
    ?.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'fullVersionList'])
    .catch(() => undefined);
  const brands = hints?.fullVersionList as { brand: string; version: string }[] | undefined;
  let icon: string | undefined;
  try {
    const iconPath = manifest?.icons?.['48'] ?? manifest?.icons?.['128'];
    if (iconPath) {
      const response = await fetch(chrome.runtime.getURL(iconPath));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length <= 9000 && response.headers.get('content-type')?.startsWith('image/png'))
        icon =
          'data:image/png;base64,' +
          btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    }
  } catch {
    /* Optional presentation metadata must not prevent connection. */
  }
  return {
    name: manifest?.name,
    icon,
    browserVersion:
      brands?.find((item) => /Google Chrome|Chromium/.test(item.brand))?.version ??
      browserInfo?.version ??
      browserVersion,
    os: platform?.os,
    osVersion: typeof hints?.platformVersion === 'string' ? hints.platformVersion : undefined,
    cpu: platform?.arch,

    development: connectionMode,
    buildDevelopment: development,
    version: chrome.runtime.getManifest?.().version || 'unknown',
  };
}
