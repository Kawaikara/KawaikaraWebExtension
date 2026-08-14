const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDeepLink,
  createShareLink,
  getMatchPatterns,
  getSiteId,
  isSupportedUrl,
} = require('../src/supported-sites.js');

test('maps supported URLs to the matching Kawaikara site', () => {
  assert.equal(
    getSiteId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'kawaikara.youtube',
  );
  assert.equal(
    getSiteId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'),
    'kawaikara.youtube-music',
  );
  assert.equal(
    getSiteId('https://www.netflix.com/watch/123'),
    'kawaikara.netflix',
  );
  assert.equal(
    getSiteId('https://chzzk.naver.com/live/example'),
    'kawaikara.chzzk',
  );
});

test('creates a Discord-friendly HTTPS share link', () => {
  const result = createShareLink(
    'https://chzzk.naver.com/live/b93b46d912f60bc4879632d39c070872',
  );
  const shareLink = new URL(result);

  assert.equal(shareLink.origin, 'https://kawaikara.github.io');
  assert.equal(shareLink.pathname, '/open/');
  assert.equal(
    shareLink.searchParams.get('url'),
    'https://chzzk.naver.com/live/b93b46d912f60bc4879632d39c070872',
  );
});

test('rejects unsupported and deceptive URLs', () => {
  assert.equal(isSupportedUrl('https://netflix.com.example.test/watch/123'), false);
  assert.equal(isSupportedUrl('javascript:alert(1)'), false);
  assert.equal(isSupportedUrl('file:///tmp/video.mp4'), false);
  assert.equal(isSupportedUrl('https://user:secret@netflix.com/watch/123'), false);
  assert.equal(isSupportedUrl('https://netflix.com:444/watch/123'), false);
  assert.equal(isSupportedUrl('not a URL'), false);
});

test('creates a safely encoded Kawaikara deep link', () => {
  const result = createDeepLink(
    'https://www.youtube.com/watch?v=abc123&list=hello world',
  );
  const deepLink = new URL(result);

  assert.equal(deepLink.protocol, 'kawaikara:');
  assert.equal(deepLink.hostname, 'open');
  assert.equal(
    deepLink.searchParams.get('url'),
    'https://www.youtube.com/watch?v=abc123&list=hello%20world',
  );
});

test('publishes root and subdomain match patterns', () => {
  const patterns = getMatchPatterns();
  assert.ok(patterns.includes('*://youtube.com/*'));
  assert.ok(patterns.includes('*://*.youtube.com/*'));
  assert.ok(patterns.includes('*://netflix.com/*'));
});
