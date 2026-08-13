const web = Bun.spawn(['bun', 'run', '--filter', '@seaveyon/harness-switch-web', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});
const server = Bun.spawn(['bun', 'run', '--filter', '@seaveyon/harness-switch', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

function shutdown() {
  web.kill();
  server.kill();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const codes = await Promise.all([web.exited, server.exited]);
process.exit(codes.find((code) => code !== 0) ?? 0);
