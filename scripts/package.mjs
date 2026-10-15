import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const destination = path.join(root, 'dist/releases');
await mkdir(destination, { recursive: true });
const archives = [];
for (const target of ['chrome', 'firefox']) {
  const directory = path.join(root, 'dist', target);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || manifest.name.includes('Development'))
    throw new Error('Build production artifacts before packaging.');
  const archive = path.join(destination, `kawaikara-web-extension-${version}-${target}.zip`);
  await rm(archive, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', archive, ...(await readdir(directory))], {
    cwd: directory,
  });
  archives.push(archive);
}
const source = path.join(destination, `kawaikara-web-extension-${version}-source.zip`);
await rm(source, { force: true });
execFileSync(
  'zip',
  [
    '-q',
    '-r',
    '-X',
    source,
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'src',
    'scripts',
    'tests',
    'icons',
    '_locales',
    'README.md',
    'Docs',
  ],
  { cwd: root },
);
archives.push(source);
await writeFile(
  path.join(destination, 'SHA256SUMS'),
  (
    await Promise.all(
      archives.map(
        async (archive) =>
          `${createHash('sha256')
            .update(await readFile(archive))
            .digest('hex')}  ${path.basename(archive)}`,
      ),
    )
  ).join('\n') + '\n',
);
for (const archive of archives) console.log(archive);
