import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDecorator, inject } from '../di';
import { IHttpClient } from './http-client';
import { IVersionService } from './version';

const REGISTRY_URL = 'https://registry.npmjs.org/';
const CHECK_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

export type UpdateCheck = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

export interface IUpdateService {
  readonly _serviceBrand: undefined;
  check(force?: boolean): Promise<UpdateCheck>;
  trigger(): Promise<void>;
}

export const IUpdateService = createDecorator<IUpdateService>('updateService');

/** Numeric dotted comparison; `a > b` means a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

@inject(IHttpClient, IVersionService)
export class UpdateService implements IUpdateService {
  declare readonly _serviceBrand: undefined;

  private cached: { latest: string | null; at: number } | undefined;

  constructor(
    private readonly http: IHttpClient,
    private readonly versions: IVersionService,
  ) {}

  /**
   * Compares the running version against the latest release on the npm registry.
   * Registry failures degrade to "no update known" instead of failing the page, and
   * are cached for the same TTL so repeated checks (doctor, dashboard) do not hammer
   * a registry that is unreachable.
   */
  async check(force = false): Promise<UpdateCheck> {
    const current = await this.versions.version();
    // Local development should be deterministic and must not depend on npm being
    // reachable. The explicit switch also prevents a cached registry result from
    // leaking into a process after checks have been disabled.
    if (process.env.HSW_UPDATE_CHECK === '0') {
      return { current, latest: null, updateAvailable: false };
    }
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.verdict(current, this.cached.latest);
    }
    try {
      const name = encodeURIComponent(await this.versions.name());
      const response = await this.http.fetch(`${REGISTRY_URL}${name}/latest`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`registry responded ${response.status}`);
      }
      const payload = (await response.json()) as { version?: unknown };
      const latest = typeof payload.version === 'string' ? payload.version : null;
      this.cached = { latest, at: Date.now() };
      return this.verdict(current, latest);
    } catch {
      // Cache the failure too: an unreachable registry stays unreachable for a while.
      this.cached = { latest: null, at: Date.now() };
      return { current, latest: null, updateAvailable: false };
    }
  }

  /**
   * Starts the update in the background with the active runtime's package runner
   * (`npx -y` for Node.js, `bun x` for Bun), downloads the
   * newest release and its daemon CLI stops this process and starts itself, so
   * the running daemon is replaced by the new version. Runs detached with its
   * own log so it survives this process being terminated.
   */
  async trigger(): Promise<void> {
    if (process.env.HSW_UPDATE_SPAWN === '0') {
      return;
    }
    const name = await this.versions.name();
    const dataDir = process.env.HSW_DATA_DIR || join(homedir(), '.harness-switch');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const logFd = openSync(join(dataDir, 'update.log'), 'w');

    const usingBun = Boolean(process.versions.bun);
    const child = spawn(
      usingBun ? 'bun' : 'npx',
      usingBun ? ['x', `${name}@latest`] : ['-y', `${name}@latest`],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: process.env,
      },
    );
    child.unref();
  }

  private verdict(current: string, latest: string | null): UpdateCheck {
    return {
      current,
      latest,
      updateAvailable: latest !== null && compareVersions(latest, current) > 0,
    };
  }
}
