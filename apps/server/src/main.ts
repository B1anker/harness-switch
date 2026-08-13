#!/usr/bin/env bun
import { createApp } from './app';
import { createServices } from './bootstrap';
import { IAuthService } from './services/auth';
import { IEnvironmentService } from './services/environment';
import { ILogService } from './services/log';

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
