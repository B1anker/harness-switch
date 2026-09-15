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

/**
 * Semver-style comparison; positive means `a` is newer. A leading `v` and build metadata
 * (`+sha`) are ignored. A pre-release (`1.2.0-beta.1`) sorts before its release and its
 * identifiers compare numerically when both sides are digits, so a dev build never
 * announces itself as an update over the release it precedes — and `NaN` never enters
 * the comparison the way `Number('0-beta')` used to.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.release.length, vb.release.length);
  for (let i = 0; i < len; i++) {
    const da = va.release[i] ?? 0;
    const db = vb.release[i] ?? 0;
    if (da !== db) {
      return da > db ? 1 : -1;
    }
  }
  // The side without a pre-release tag is the release, and the release is newer.
  if (va.pre.length === 0 && vb.pre.length === 0) {
    return 0;
  }
  if (va.pre.length === 0) {
    return 1;
  }
  if (vb.pre.length === 0) {
    return -1;
  }
  const preLen = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < preLen; i++) {
    const pa = va.pre[i];
    const pb = vb.pre[i];
    // A shorter identifier list is the older pre-release (`beta` < `beta.1`).
    if (pa === undefined) {
      return -1;
    }
    if (pb === undefined) {
      return 1;
    }
    const na = /^\d+$/.test(pa) ? Number(pa) : undefined;
    const nb = /^\d+$/.test(pb) ? Number(pb) : undefined;
    if (na !== undefined && nb !== undefined) {
      if (na !== nb) {
        return na > nb ? 1 : -1;
      }
      continue;
    }
    // Numeric identifiers sort before alphanumeric ones, as semver specifies.
    if (na !== undefined) {
      return -1;
    }
    if (nb !== undefined) {
      return 1;
    }
    if (pa !== pb) {
      return pa > pb ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(value: string): { release: number[]; pre: string[] } {
  const trimmed = value.trim().replace(/^v/i, '');
  const withoutBuild = trimmed.split('+', 1)[0] ?? '';
  const dash = withoutBuild.indexOf('-');
  const releasePart = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prePart = dash === -1 ? '' : withoutBuild.slice(dash + 1);
  const release = releasePart.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { release, pre: prePart ? prePart.split('.') : [] };
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
