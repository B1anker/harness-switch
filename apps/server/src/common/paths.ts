import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** Purely lexical, so callers that care about symlinks resolve with `realPath` first. */
export function isInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  return (
    normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  );
}

/**
 * Resolves the symlinks in the part of `target` that already exists and keeps the
 * components that do not, so a file still to be created is judged by its real parents
 * instead of being accepted unchecked.
 */
export function realPath(target: string): string {
  const absolute = resolve(target);
  const missing: string[] = [];
  let cursor = absolute;
  for (;;) {
    try {
      return join(realpathSync(cursor), ...missing.toReversed());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return absolute;
    }
    missing.push(basename(cursor));
    cursor = parent;
  }
}
