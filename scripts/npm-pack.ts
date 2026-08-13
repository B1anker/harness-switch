import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const serverDir = join(import.meta.dir, '../apps/server');
const pkgPath = join(serverDir, 'package.json');
const original = readFileSync(pkgPath, 'utf8');
const dryRun = process.argv.includes('--dry-run');

try {
  const pkg = JSON.parse(original) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // dist/harness-switch.js already bundles workspace and runtime deps.
  delete pkg.dependencies;
  delete pkg.devDependencies;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const args = ['pm', 'pack', ...(dryRun ? ['--dry-run'] : [])];
  const result = Bun.spawnSync(['bun', ...args], {
    cwd: serverDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    throw new Error(`bun pm pack failed with exit ${result.exitCode}`);
  }
} finally {
  writeFileSync(pkgPath, original);
}
