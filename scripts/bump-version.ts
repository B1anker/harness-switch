import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) {
  throw new Error('usage: bun scripts/bump-version.ts <version>');
}

const path = join(import.meta.dir, '../apps/server/package.json');
const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version: string };
pkg.version = version;
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`bumped ${path} to ${version}`);
