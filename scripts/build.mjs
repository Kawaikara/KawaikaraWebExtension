import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const development = process.argv.includes('--development');
const outputRoot = path.join(projectRoot, development ? 'dist/development' : 'dist');
const targets = ['chrome', 'firefox'];

const commonManifest = {
  manifest_version: 3,
  name: development ? 'Kawaikara WebExtension Development' : '__MSG_extensionName__',
  description: '__MSG_extensionDescription__',
  version: JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version,
  default_locale: 'en',
  permissions: ['activeTab', 'clipboardWrite', 'contextMenus', 'scripting', 'storage', 'alarms'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  host_permissions: ['http://127.0.0.1/*'],
  content_scripts: [
    {
      matches: ['http://127.0.0.1/extension-connect*'],
      js: ['connect-content.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  options_ui: { page: 'options.html', open_in_tab: true },
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: '__MSG_extensionName__',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
};

for (const target of targets)
  await rm(path.join(outputRoot, target), { recursive: true, force: true });

for (const target of targets) {
  const outputDirectory = path.join(outputRoot, target);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    ...[
      'background',
      'provider-contract',
      'provider-content',
      'options',
      'launch',
      'connect-content',
    ].map((name) =>
      build({
        entryPoints: [
          path.join(projectRoot, 'src', `${name}.${name === 'options' ? 'tsx' : 'ts'}`),
        ],
        bundle: true,
        define: {
          'process.env.NODE_ENV': '"production"',
          __KAWAIKARA_DEVELOPMENT__: JSON.stringify(development),
          __KAWAIKARA_FIREFOX__: JSON.stringify(target === 'firefox'),
        },
        loader: { '.png': 'dataurl' },
        format: 'iife',
        target: ['chrome121', 'firefox128'],
        ...(name === 'provider-contract' ? { globalName: 'KawaikaraContract' } : {}),
        outfile: path.join(outputDirectory, `${name}.js`),
      }),
    ),
    cp(path.join(projectRoot, 'src/launch.html'), path.join(outputDirectory, 'launch.html')),
    cp(path.join(projectRoot, 'src/options.html'), path.join(outputDirectory, 'options.html')),
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
          background: {
            scripts: ['provider-contract.js', 'background.js'],
          },
          browser_specific_settings: {
            gecko: {
              id: development ? 'development@kawaikara.app' : 'open-in-kawaikara@kawaikara.app',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['browsingActivity'] },
            },
          },
        }),
  };

  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

console.log('Built Chrome and Firefox Provider-driven extensions.');
