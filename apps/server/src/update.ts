import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { packageName, serverVersion } from './version';

const REGISTRY_URL = 'https://registry.npmjs.org/';
const CHECK_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

export type UpdateCheck = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

let cached: { latest: string | null; at: number } | undefined;

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

/**
 * Compares the running version against the latest release on the npm registry.
 * Registry failures degrade to "no update known" instead of failing the page, and
 * are cached for the same TTL so repeated checks (doctor, dashboard) do not hammer
 * a registry that is unreachable.
 */
export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  const current = await serverVersion();
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return {
      current,
      latest: cached.latest,
      updateAvailable: cached.latest !== null && compareVersions(cached.latest, current) > 0,
    };
  }
  try {
    const name = encodeURIComponent(await packageName());
    const response = await fetch(`${REGISTRY_URL}${name}/latest`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`registry responded ${response.status}`);
    }
    const payload = (await response.json()) as { version?: unknown };
    const latest = typeof payload.version === 'string' ? payload.version : null;
    cached = { latest, at: Date.now() };
    return {
      current,
      latest,
      updateAvailable: latest !== null && compareVersions(latest, current) > 0,
    };
  } catch {
    // Cache the failure too: an unreachable registry stays unreachable for a while.
    cached = { latest: null, at: Date.now() };
    return { current, latest: null, updateAvailable: false };
  }
}

/**
 * Starts the update in the background: `bun x <package>@latest` downloads the
 * newest release and its daemon CLI stops this process and starts itself, so
 * the running daemon is replaced by the new version. Runs detached with its
 * own log so it survives this process being terminated.
 */
export async function triggerUpdate(): Promise<void> {
  if (process.env.HSW_UPDATE_SPAWN === '0') {
    return;
  }
  const name = await packageName();
  const dataDir = process.env.HSW_DATA_DIR || join(homedir(), '.harness-switch');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(dataDir, 'update.log'), 'w');

  const child = spawn(process.execPath, ['x', `${name}@latest`], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
}
