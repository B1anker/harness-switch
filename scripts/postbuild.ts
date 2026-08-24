import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dir, '..');
const serverDir = join(root, 'apps/server');
const bundle = join(serverDir, 'dist/harness-switch.js');

if (!existsSync(bundle)) {
  throw new Error(`missing bundle: ${bundle}`);
}

const content = readFileSync(bundle, 'utf8');
if (!content.startsWith('#!/usr/bin/env node')) {
  writeFileSync(bundle, `#!/usr/bin/env node\n${content}`);
}
chmodSync(bundle, 0o755);
copyFileSync(join(root, 'README.md'), join(serverDir, 'README.md'));
copyFileSync(join(root, 'LICENSE'), join(serverDir, 'LICENSE'));

console.log(`postbuild: ${dirname(bundle)}`);
