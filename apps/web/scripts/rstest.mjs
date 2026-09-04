#!/usr/bin/env node
/**
 * Rstest's default reporter draws a live "RUNS" window with cursor-up / erase-line /
 * synchronized-update escapes. That looks right in a real terminal, but log viewers
 * (GitHub Actions UI, agent captures, pipes) print the escapes as garbage.
 *
 * The window is only skipped when `CI` is set, not when stdout is a non-TTY — so mark
 * non-interactive runs as CI before spawning rstest.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.stdout.isTTY && process.env.CI === undefined) {
  process.env.CI = '1';
}

const packageJson = fileURLToPath(import.meta.resolve('@rstest/core/package.json'));
const bin = join(dirname(packageJson), 'bin/rstest.js');
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
