import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const STOP_TIMEOUT_MS = 5_000;
const START_GRACE_MS = 500;

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

function readPid(): number | null {
  try {
    const raw = readFileSync(daemonPidFile(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
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

export async function stopDaemon(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    console.log('no harness-switch daemon pid file found');
    return;
  }
  if (!isAlive(pid)) {
    console.log(`daemon pid ${pid} is not running; removing stale pid file`);
    try {
      unlinkSync(daemonPidFile());
    } catch {
      // already gone
    }
    return;
  }
  console.log(`stopping harness-switch daemon (pid ${pid})...`);
  await killProcess(pid);
  try {
    unlinkSync(daemonPidFile());
  } catch {
    // already gone
  }
  console.log('stopped');
}

export function printStatus(): void {
  const pid = readPid();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const running = pid !== null && isAlive(pid);
  console.log(`harness-switch daemon: ${running ? `running (pid ${pid})` : 'not running'}`);
  console.log(`  url: http://${host}:${port}`);
  console.log(`  log: ${daemonLogFile()}`);
  console.log(`  password: ${join(daemonDataDir(), 'web_password')}`);
  console.log(`  data: ${daemonDataDir()}`);
}

/**
 * Start the server as a detached background process. If a previous daemon is
 * running it is stopped first, so re-running after an update (for example
 * `bunx @seaveyon/harness-switch@latest`) serves the newest version.
 */
export async function daemonize(): Promise<void> {
  const previous = readPid();
  if (previous !== null && isAlive(previous)) {
    console.log(`restarting harness-switch daemon (previous pid ${previous})...`);
    await killProcess(previous);
  }

  mkdirSync(daemonDataDir(), { recursive: true, mode: 0o700 });

  const entry = resolve(process.argv[1] ?? 'harness-switch.js');
  const logPath = daemonLogFile();
  // Fresh log per daemon start; the child inherits the fd directly so it keeps
  // writing even after this parent exits.
  const logFd = openSync(logPath, 'w');

  const child = spawn(process.execPath, [entry, 'server'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();

  await Bun.sleep(START_GRACE_MS);
  if (child.exitCode !== null || child.signalCode !== null) {
    console.error(`daemon exited immediately (code ${child.exitCode}); tail of ${logPath}:`);
    try {
      const tail = (await Bun.file(logPath).text()).split('\n').slice(-15).join('\n');
      console.error(tail);
    } catch {
      // log missing; nothing more to show
    }
    process.exit(1);
  }

  writeFileSync(daemonPidFile(), `${child.pid}\n`, { mode: 0o600 });

  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT || DEFAULT_PORT);
  console.log(`harness-switch daemon started (pid ${child.pid})`);
  console.log(`  url: http://${host}:${port}`);
  console.log(`  log: ${logPath}`);
  console.log('  manage: harness-switch status | harness-switch stop');
  console.log(`  password (first run): ${join(daemonDataDir(), 'web_password')}`);
}

export function usage(): string {
  return [
    'usage: harness-switch [server|daemon|status|stop]',
    '       harness-switch [list|providers|doctor|plan|activate|users|sync] [options]',
    '       harness-switch [scan|import|operations|undo] [options]',
    '       CLI commands run against the local data directory; add --json for machine output',
  ].join('\n');
}
