import { createRequire } from 'node:module';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const support = require(path.join(projectRoot, 'src/supported-sites.js'));
const outputRoot = path.join(projectRoot, 'dist');
const targets = ['chrome', 'firefox'];

const commonManifest = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  description: '__MSG_extensionDescription__',
  version: '0.4.0',
  default_locale: 'ko',
  permissions: ['activeTab', 'clipboardWrite', 'contextMenus', 'scripting'],
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: '__MSG_openInKawaikara__',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
  content_scripts: [
    {
      matches: ['*://youtube.com/*', '*://*.youtube.com/*'],
      js: ['supported-sites.js', 'youtube-context-menu.js'],
      run_at: 'document_idle',
    },
    {
      matches: [
        '*://chzzk.naver.com/*',
        '*://*.chzzk.naver.com/*',
      ],
      js: ['supported-sites.js', 'chzzk-context-menu.js'],
      run_at: 'document_idle',
    },
  ],
};

await rm(outputRoot, { recursive: true, force: true });

for (const target of targets) {
  const outputDirectory = path.join(outputRoot, target);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    cp(path.join(projectRoot, 'src/background.js'), path.join(outputDirectory, 'background.js')),
    cp(
      path.join(projectRoot, 'src/supported-sites.js'),
      path.join(outputDirectory, 'supported-sites.js'),
    ),
    cp(
      path.join(projectRoot, 'src/youtube-context-menu.js'),
      path.join(outputDirectory, 'youtube-context-menu.js'),
    ),
    cp(
      path.join(projectRoot, 'src/chzzk-context-menu.js'),
      path.join(outputDirectory, 'chzzk-context-menu.js'),
    ),
    cp(path.join(projectRoot, '_locales'), path.join(outputDirectory, '_locales'), {
      recursive: true,
    }),
    cp(path.join(projectRoot, 'icons'), path.join(outputDirectory, 'icons'), {
      recursive: true,
    }),
  ]);

  const manifest = {
    ...commonManifest,
    ...(target === 'chrome'
      ? {
          minimum_chrome_version: '121',
          background: { service_worker: 'background.js' },
        }
      : {
          background: { scripts: ['supported-sites.js', 'background.js'] },
          browser_specific_settings: {
            gecko: {
              id: 'open-in-kawaikara@kawaikara.app',
              strict_min_version: '128.0',
            },
          },
        }),
  };

  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

const generatedPatterns = support.getMatchPatterns();
const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8');
if (generatedPatterns.length === 0 || !readme.includes('kawaikara://open')) {
  throw new Error('Build validation failed.');
}

console.log(`Built Chrome and Firefox extensions (${generatedPatterns.length} URL patterns).`);
