import { readFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecorator } from '../di';

export type PackageInfo = { name: string; version: string };

export interface IVersionService {
  readonly _serviceBrand: undefined;
  info(): Promise<PackageInfo>;
  version(): Promise<string>;
  name(): Promise<string>;
}

export const IVersionService = createDecorator<IVersionService>('versionService');

const FALLBACK: PackageInfo = { name: 'harness-switch', version: '0.0.0' };

/**
 * The identity of the running package, read at runtime from the nearest package.json.
 * The release pipeline bumps the version *after* the build step, so the value must not
 * be inlined at build time.
 */
export class VersionService implements IVersionService {
  declare readonly _serviceBrand: undefined;

  private cached: PackageInfo | undefined;

  async info(): Promise<PackageInfo> {
    this.cached ??= (await readManifest()) ?? FALLBACK;
    return this.cached;
  }

  version(): Promise<string> {
    return this.info().then((info) => info.version);
  }

  name(): Promise<string> {
    return this.info().then((info) => info.name);
  }
}

/**
 * Walks up from this module rather than hard-coding a depth, because the same code runs
 * from two different layouts: bundled as `dist/harness-switch.js`, and unbundled from
 * `src/services/` under `bun --hot`. Both reach `apps/server/package.json`.
 */
async function readManifest(): Promise<PackageInfo | undefined> {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);
  while (true) {
    const parsed = await readJson(join(dir, 'package.json'));
    if (parsed) {
      return {
        name: typeof parsed.name === 'string' ? parsed.name : FALLBACK.name,
        version: typeof parsed.version === 'string' ? parsed.version : FALLBACK.version,
      };
    }
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  return readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as unknown)
    .then((value) =>
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined,
    )
    .catch(() => undefined);
}
