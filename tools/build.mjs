// Builds dist/ from scratch.
//
// tsc rewrites the `.ts` import extensions to `.js` in the JavaScript it emits
// but leaves them in the declaration files. They are rewritten here so that the
// published types resolve under every TypeScript module setting.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' });

let rewritten = 0;
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
  const file = join(entry.parentPath, entry.name);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2');
  if (after !== before) {
    writeFileSync(file, after);
    rewritten += 1;
  }
}
console.log(`built dist/ (${rewritten} declaration files rewritten)`);
