// Copy only the shared adapter contract; Provider catalogs arrive from the connected app.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.resolve(process.argv[2] || path.join(root, '../kawaikara/dev3'));
await writeFile(
  path.join(root, 'src/provider-contract.ts'),
  '// Generated from packages/site-api/src/WebExtension.ts.\n' +
    (await readFile(path.join(desktop, 'packages/site-api/src/WebExtension.ts'), 'utf8')),
);
console.log('Synced the shared adapter contract; no Provider catalog is bundled.');
