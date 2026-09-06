import { join } from 'node:path';

const publicDir = join(import.meta.dir, '..', 'apps', 'server', '.dev-public');

const web = Bun.spawn(['bun', 'run', '--filter', '@seaveyon/harness-switch-web', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});
const server = Bun.spawn(['bun', 'run', '--filter', '@seaveyon/harness-switch', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  // The first web compilation is asynchronous; pin the API to its eventual output
  // directory rather than resolving a fallback before index.html exists.
  env: { ...process.env, HSW_PUBLIC_DIR: publicDir },
});

function shutdown() {
  web.kill();
  server.kill();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const codes = await Promise.all([web.exited, server.exited]);
process.exit(codes.find((code) => code !== 0) ?? 0);
