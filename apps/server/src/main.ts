#!/usr/bin/env node
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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

  const server = createServer((request, response) => {
    void handleNodeRequest(app.fetch, request, response);
  });
  server.listen(environment.port, environment.host);
  await once(server, 'listening');

  log.info(`data directory: ${environment.dataDir}`);
  log.info(`listening on http://${environment.host}:${environment.port}`);
}

/** Adapt Node's HTTP server to Hono's standard Fetch handler without a runtime adapter. */
async function handleNodeRequest(
  handler: (request: Request) => Response | Promise<Response>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const origin = `http://${request.headers.host ?? 'localhost'}`;
    const body = ['GET', 'HEAD'].includes(request.method ?? '')
      ? undefined
      : await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const result = await handler(
      new Request(new URL(request.url ?? '/', origin).toString(), {
        method: request.method,
        headers,
        ...(body ? { body, duplex: 'half' as const } : {}),
      }),
    );
    response.statusCode = result.status;
    const cookies = result.headers.getSetCookie?.() ?? [];
    for (const [name, value] of result.headers) {
      if (name !== 'set-cookie') response.setHeader(name, value);
    }
    if (cookies.length > 0) response.setHeader('set-cookie', cookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.statusCode = 500;
    response.end('internal server error');
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
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
