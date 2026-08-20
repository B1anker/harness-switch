#!/usr/bin/env bun
import { createApp } from './app';
import { createServices } from './bootstrap';
import { parseArgs } from './cli/args';
import { runCli } from './cli/commands';
import { daemonize, printStatus, stopDaemon, usage } from './daemon';
import { IAuthService } from './services/auth';
import { IEnvironmentService } from './services/environment';
import { ILogService } from './services/log';

async function runServer(): Promise<void> {
  const services = createServices();
  const environment = services.get(IEnvironmentService);
  const log = services.get(ILogService);
  const auth = services.get(IAuthService);

  environment.ensureDataDir();
  auth.ensurePassword();

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

if (command === 'server') {
  await runServer();
} else if (command === 'stop') {
  await stopDaemon();
} else if (command === 'status') {
  printStatus();
} else if (
  command === 'list' ||
  command === 'providers' ||
  command === 'doctor' ||
  command === 'plan' ||
  command === 'activate'
) {
  const { flags, positional } = parseArgs(rest);
  process.exitCode = await runCli(command, positional, flags);
} else if (command === undefined || command === 'daemon') {
  await daemonize();
} else {
  console.error(`unknown command: ${command}`);
  console.error(usage());
  process.exit(1);
}
