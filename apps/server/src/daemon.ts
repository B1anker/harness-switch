import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const STOP_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 5_000;

type DaemonRecord = {
  version: 1;
  pid: number;
  token: string;
  host: string;
  port: number;
  startedAt: string;
};

type StoredDaemon = DaemonRecord | { version: 0; pid: number };

/** Mirrors EnvironmentService so the daemon parent can manage its own bookkeeping. */
export function daemonDataDir(): string {
  return process.env.HSW_DATA_DIR || join(homedir(), '.harness-switch');
}

export function daemonPidFile(): string {
  return join(daemonDataDir(), 'daemon.pid');
}

export function daemonLogFile(): string {
  return join(daemonDataDir(), 'daemon.log');
}

function readRecord(): StoredDaemon | null {
  try {
    const raw = readFileSync(daemonPidFile(), 'utf8').trim();
    if (/^\d+$/.test(raw)) {
      const pid = Number(raw);
      return Number.isInteger(pid) && pid > 0 ? { version: 0, pid } : null;
    }
    const value = JSON.parse(raw) as Partial<DaemonRecord>;
    return value.version === 1 &&
      Number.isInteger(value.pid) &&
      value.pid! > 0 &&
      typeof value.token === 'string' &&
      typeof value.host === 'string' &&
      typeof value.port === 'number' &&
      typeof value.startedAt === 'string'
      ? (value as DaemonRecord)
      : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = STOP_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(100);
  }
  return !isAlive(pid);
}

/** SIGTERM the pid, escalate to SIGKILL if it does not exit in time. */
async function killProcess(pid: number): Promise<boolean> {
  if (!isAlive(pid)) return true;
  process.kill(pid, 'SIGTERM');
  if (await waitForExit(pid)) return true;
  process.kill(pid, 'SIGKILL');
  return waitForExit(pid, 3_000);
}

export async function stopDaemon(): Promise<number> {
  const record = readRecord();
  if (record === null) {
    console.log('no harness-switch daemon pid file found');
    return 0;
  }
  const { pid } = record;
  if (!isAlive(pid)) {
    console.log(`daemon pid ${pid} is not running; removing stale pid file`);
    try {
      unlinkSync(daemonPidFile());
    } catch {
      // already gone
    }
    return 0;
  }
  if (!(await isOwnedDaemon(record))) {
    console.error(
      `refusing to stop pid ${pid}: the pid file does not identify a running harness-switch daemon`,
    );
    return 1;
  }
  console.log(`stopping harness-switch daemon (pid ${pid})...`);
  if (!(await killProcess(pid))) {
    console.error(`failed to stop harness-switch daemon (pid ${pid}); pid file kept`);
    return 1;
  }
  try {
    unlinkSync(daemonPidFile());
  } catch {
    // already gone
  }
  console.log('stopped');
  return 0;
}

export async function printStatus(): Promise<number> {
  const record = readRecord();
  const host = record?.version === 1 ? record.host : process.env.HOST || DEFAULT_HOST;
  const port = record?.version === 1 ? record.port : Number(process.env.PORT || DEFAULT_PORT);
  const owned = record !== null && isAlive(record.pid) && (await isOwnedDaemon(record));
  const running = owned && (record.version === 0 || (await checkHealth(record)));
  console.log(`harness-switch daemon: ${running ? `running (pid ${record.pid})` : 'not running'}`);
  console.log(`  url: ${httpOrigin(host, port)}`);
  console.log(`  log: ${daemonLogFile()}`);
  console.log(`  password: ${join(daemonDataDir(), 'web_password')}`);
  console.log(`  data: ${daemonDataDir()}`);
  return running ? 0 : 1;
}

/**
 * Start the server as a detached background process. If a previous daemon is
 * running it is stopped first, so re-running after an update (for example
 * `bunx @seaveyon/harness-switch@latest`) serves the newest version.
 */
export async function daemonize(): Promise<number> {
  const previous = readRecord();
  if (previous !== null && isAlive(previous.pid)) {
    if (!(await isOwnedDaemon(previous))) {
      console.error(
        `refusing to replace unverified pid ${previous.pid}; remove ${daemonPidFile()} after checking it`,
      );
      return 1;
    }
    console.log(`restarting harness-switch daemon (previous pid ${previous.pid})...`);
    if (!(await killProcess(previous.pid))) {
      console.error(`failed to stop previous daemon (pid ${previous.pid})`);
      return 1;
    }
  }

  mkdirSync(daemonDataDir(), { recursive: true, mode: 0o700 });

  const entry = resolve(process.argv[1] ?? 'harness-switch.js');
  const logPath = daemonLogFile();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const token = randomBytes(24).toString('base64url');
  // Fresh log per daemon start; the child inherits the fd directly so it keeps
  // writing even after this parent exits.
  const logFd = openSync(logPath, 'w');

  const child = spawn(process.execPath, [entry, 'server'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, HSW_DAEMON_TOKEN: token },
  });
  closeSync(logFd);
  child.unref();

  const record: DaemonRecord = {
    version: 1,
    pid: child.pid!,
    token,
    host,
    port,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(daemonPidFile(), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

  if (!(await waitForReady(record, START_TIMEOUT_MS))) {
    if (isAlive(record.pid)) await killProcess(record.pid);
    removeRecordIfMatches(token);
    console.error(`daemon failed its health check; tail of ${logPath}:`);
    try {
      console.error((await Bun.file(logPath).text()).split('\n').slice(-15).join('\n'));
    } catch {
      // log missing; nothing more to show
    }
    return 1;
  }

  console.log(`harness-switch daemon started (pid ${child.pid})`);
  console.log(`  url: http://${host}:${port}`);
  console.log(`  log: ${logPath}`);
  console.log('  manage: harness-switch status | harness-switch stop');
  console.log(`  password (first run): ${join(daemonDataDir(), 'web_password')}`);
  return 0;
}

async function isOwnedDaemon(record: StoredDaemon): Promise<boolean> {
  if (!isAlive(record.pid)) return false;
  if (record.version === 0) return processLooksLikeHarnessSwitch(record.pid);
  if (processHasToken(record.pid, record.token)) return true;
  return checkHealth(record);
}

function processHasToken(pid: number, token: string): boolean {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .includes(`HSW_DAEMON_TOKEN=${token}`);
  } catch {
    return false;
  }
}

function processLooksLikeHarnessSwitch(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('harness-switch');
  } catch {
    return false;
  }
}

async function waitForReady(record: DaemonRecord, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) return false;
    if (await checkHealth(record)) return true;
    await Bun.sleep(100);
  }
  return false;
}

async function checkHealth(record: DaemonRecord): Promise<boolean> {
  try {
    const response = await fetch(`${httpOrigin(record.host, record.port)}/healthz`, {
      signal: AbortSignal.timeout(500),
    });
    const payload = (await response.json()) as { ok?: unknown; instance?: unknown };
    return response.ok && payload.ok === true && payload.instance === record.token;
  } catch {
    return false;
  }
}

function httpOrigin(host: string, port: number): string {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `http://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${port}`;
}

function removeRecordIfMatches(token: string): void {
  const record = readRecord();
  if (record?.version !== 1 || record.token !== token) return;
  try {
    unlinkSync(daemonPidFile());
  } catch {
    // already gone
  }
}
