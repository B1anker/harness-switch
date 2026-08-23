#!/usr/bin/env bun
import { createApp } from './app';
import { createServices } from './bootstrap';
import { parseArgs } from './cli/args';
import { runCli } from './cli/commands';
import { cliUsage, printJson } from './cli/output';
import { daemonize, printStatus, stopDaemon } from './daemon';
import { IAuthService } from './services/auth';
import { IEnvironmentService } from './services/environment';
import { IJournalService } from './services/journal';
import { ILogService } from './services/log';
import { serverVersion } from './version';

async function runServer(): Promise<void> {
  const services = createServices();
  const environment = services.get(IEnvironmentService);
  const log = services.get(ILogService);
  const auth = services.get(IAuthService);

  environment.ensureDataDir();
  auth.ensurePassword();

  // A power cut or SIGKILL mid-operation leaves native files, the store and the active
  // pointer disagreeing. Settle that before serving the first request.
  services.get(IJournalService).recoverAll();

  const app = createApp(services);

  const server = Bun.serve({
    hostname: environment.host,
    port: environment.port,
    fetch: app.fetch,
  });

  log.info(`data directory: ${environment.dataDir}`);
  log.info(`listening on http://${server.hostname}:${server.port}`);
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(cliUsage());
} else if (command === 'version' || command === '--version' || command === '-V') {
  console.log(await serverVersion());
} else if (rest.includes('--help') || rest.includes('-h')) {
  console.log(cliUsage());
} else if (rest.includes('--version') || rest.includes('-V')) {
  console.log(await serverVersion());
} else if (command === 'server') {
  await runServer();
} else if (command === 'stop') {
  process.exitCode = await stopDaemon();
} else if (command === 'status') {
  process.exitCode = await printStatus();
} else if (
  command === 'list' ||
  command === 'profiles' ||
  command === 'create' ||
  command === 'delete' ||
  command === 'providers' ||
  command === 'doctor' ||
  command === 'plan' ||
  command === 'activate' ||
  command === 'official' ||
  command === 'users' ||
  command === 'sync' ||
  command === 'scan' ||
  command === 'import' ||
  command === 'operations' ||
  command === 'undo'
) {
  try {
    const { flags, positional } = parseArgs(rest);
    process.exitCode = await runCli(command, positional, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (rest.includes('--json') || rest.includes('-j')) printJson({ error: { code: 1, message } });
    else console.error(`error: ${message}`);
    process.exitCode = 1;
  }
} else if (command === undefined || command === 'daemon') {
  process.exitCode = await daemonize();
} else {
  console.error(`unknown command: ${command}`);
  console.error(cliUsage());
  process.exit(1);
}
