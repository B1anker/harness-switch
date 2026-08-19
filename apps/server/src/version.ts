import { join } from 'node:path';

type PackageInfo = { name: string; version: string };

let cached: PackageInfo | undefined;

/**
 * The identity of the running package, read at runtime from the package.json
 * next to this bundle. The release pipeline bumps the version *after* the
 * build step, so the value must not be inlined at build time.
 */
export async function packageInfo(): Promise<PackageInfo> {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(await Bun.file(join(import.meta.dir, '../package.json')).text()) as {
      name?: unknown;
      version?: unknown;
    };
    cached = {
      name: typeof pkg.name === 'string' ? pkg.name : 'harness-switch',
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    };
  } catch {
    cached = { name: 'harness-switch', version: '0.0.0' };
  }
  return cached;
}

export function serverVersion(): Promise<string> {
  return packageInfo().then((info) => info.version);
}

export function packageName(): Promise<string> {
  return packageInfo().then((info) => info.name);
}
