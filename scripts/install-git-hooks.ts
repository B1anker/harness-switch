import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const gitDir = join(root, '.git');
if (!existsSync(gitDir)) {
  process.exit(0);
}

const hooksDir = join(gitDir, 'hooks');
mkdirSync(hooksDir, { recursive: true });

const source = join(root, '.githooks/pre-commit');
const dest = join(hooksDir, 'pre-commit');
copyFileSync(source, dest);
chmodSync(dest, 0o755);
chmodSync(source, 0o755);
