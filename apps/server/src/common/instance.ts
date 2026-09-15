import { createHash } from 'node:crypto';

/**
 * What `/healthz` answers for "which daemon is this". The parent that spawned the daemon
 * holds the raw token (pid file, 0600) and compares digests, so the unauthenticated
 * health endpoint never has to put the token itself on the wire.
 */
export function instanceFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
