(function exposeSupportedSites(root, factory) {
  const supportedSites = factory();
  root.KawaikaraSupport = supportedSites;
  if (typeof module === 'object' && module.exports) {
    module.exports = supportedSites;
  }
})(typeof globalThis === 'object' ? globalThis : this, function createSupportedSites() {
  'use strict';

  const SITE_RULES = Object.freeze([
    { id: 'kawaikara.youtube-music', domains: ['music.youtube.com'] },
    { id: 'kawaikara.apple-music', domains: ['music.apple.com'] },
    { id: 'kawaikara.apple-tv', domains: ['tv.apple.com'] },
    { id: 'kawaikara.chzzk', domains: ['chzzk.naver.com'] },
    { id: 'kawaikara.spotify', domains: ['open.spotify.com'] },
    { id: 'kawaikara.youtube', domains: ['youtube.com', 'youtu.be'] },
    { id: 'kawaikara.netflix', domains: ['netflix.com'] },
    { id: 'kawaikara.laftel', domains: ['laftel.net'] },
    { id: 'kawaikara.disneyplus', domains: ['disneyplus.com'] },
    { id: 'kawaikara.amazon-prime-video', domains: ['primevideo.com'] },
    { id: 'kawaikara.wavve', domains: ['wavve.com'] },
    { id: 'kawaikara.watcha', domains: ['watcha.com'] },
    { id: 'kawaikara.coupang-play', domains: ['coupangplay.com'] },
    { id: 'kawaikara.tving', domains: ['tving.com'] },
    { id: 'kawaikara.crunchyroll', domains: ['crunchyroll.com'] },
    { id: 'kawaikara.twitch', domains: ['twitch.tv'] },
    { id: 'kawaikara.ridibooks', domains: ['ridibooks.com'] },
  ]);

  function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function getSiteId(value) {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:') ||
        url.username ||
        url.password ||
        url.port
      ) {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      const rule = SITE_RULES.find(({ domains }) =>
        domains.some((domain) => domainMatches(hostname, domain)),
      );
      return rule ? rule.id : null;
    } catch {
      return null;
    }
  }

  function isSupportedUrl(value) {
    return getSiteId(value) !== null;
  }

  function createDeepLink(value) {
    if (!isSupportedUrl(value)) {
      return null;
    }
    const target = new URL(value);
    if (target.protocol === 'http:') {
      target.protocol = 'https:';
    }
    const deepLink = new URL('kawaikara://open');
    deepLink.searchParams.set('url', target.href);
    return deepLink.href;
  }

  function createShareLink(value) {
    if (!isSupportedUrl(value)) {
      return null;
    }
    const target = new URL(value);
    if (target.protocol === 'http:') {
      target.protocol = 'https:';
    }
    const shareLink = new URL('https://kawaikara.github.io/open/');
    shareLink.searchParams.set('url', target.href);
    return shareLink.href;
  }

  function getMatchPatterns() {
    const domains = new Set(
      SITE_RULES.flatMap(({ domains: ruleDomains }) => ruleDomains),
    );
    return [...domains].flatMap((domain) => [
      `*://${domain}/*`,
      `*://*.${domain}/*`,
    ]);
  }

  return Object.freeze({
    SITE_RULES,
    createDeepLink,
    createShareLink,
    getMatchPatterns,
    getSiteId,
    isSupportedUrl,
  });
});
