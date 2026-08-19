import { join } from 'node:path';

let cached: string | undefined;

/**
 * The version of the running package, read at runtime from the package.json
 * next to this bundle. The release pipeline bumps the version *after* the
 * build step, so the value must not be inlined at build time.
 */
export async function serverVersion(): Promise<string> {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(await Bun.file(join(import.meta.dir, '../package.json')).text()) as {
      version?: unknown;
    };
    cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
