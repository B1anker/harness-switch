import { expect } from 'bun:test';
import { statSync } from 'node:fs';

/**
 * Whether the host has POSIX file semantics: mode bits a `chmod` can take away, uid/gid
 * ownership, ENOTDIR for a path that runs through a regular file. Windows has none of
 * them — a `chmod 000` file stays readable, a `0600` write reads back as `0666` — and the
 * product already knows it (`applyOwner` and the user-access probe short-circuit on
 * win32). A test whose fixture rests on one of those guarantees has nothing to check
 * there, so it is skipped rather than left to pass for the wrong reason.
 */
export const POSIX = process.platform !== 'win32';

/** Asserts a file's mode bits where the filesystem has them; on Windows there are none to read. */
export function expectMode(file: string, mode: number): void {
  if (!POSIX) {
    return;
  }
  expect(statSync(file).mode & 0o777).toBe(mode);
}
