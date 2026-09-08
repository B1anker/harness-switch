import type { AuditEntry } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';

/**
 * The security-relevant events, as a closed set.
 *
 * The operation journal already records what was written to a harness config and can undo
 * it. This is the other half: who authenticated, whose credential was revealed, and when
 * the shared password changed — none of which touch a native file, so none of which the
 * journal sees. Adding an event here is cheap; renaming one breaks whoever greps the file.
 */
export const AUDIT_EVENTS = {
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  loginLocked: 'auth.login.locked',
  logout: 'auth.logout',
  passwordChanged: 'auth.password.changed',
  passwordChangeRejected: 'auth.password.rejected',
  userSelected: 'user.selected',
  credentialRevealed: 'provider.credential.revealed',
  profileActivated: 'profile.activated',
  officialActivated: 'profile.official.activated',
} as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export interface IAuditService {
  readonly _serviceBrand: undefined;
  record(event: AuditEvent, detail?: Record<string, string | number | boolean>): void;
  /** Newest first, capped. For the operator who wants to read the trail without a shell. */
  list(limit?: number): AuditEntry[];
}

export const IAuditService = createDecorator<IAuditService>('auditService');

/** Keys whose value is never written, whatever a caller passes. */
const FORBIDDEN_DETAIL = new Set(['apiKey', 'password', 'token', 'secret', 'credential']);

const DEFAULT_LIMIT = 200;

/**
 * Appends events to `audit.jsonl` in the manager's data directory.
 *
 * JSONL rather than one JSON document: an append is a single write that cannot lose
 * earlier entries, and `tail -f` works on it. Rotation is deliberately absent — an entry
 * is well under 200 bytes and the events are rare enough that the file stays small for
 * years, so a rotation scheme would be more moving parts than the problem deserves.
 */
@inject(IEnvironmentService, IFileService, ILogService)
export class AuditService implements IAuditService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly log: ILogService,
  ) {}

  record(event: AuditEvent, detail?: Record<string, string | number | boolean>): void {
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      event,
      user: this.environment.currentUser.username,
      ...(detail ? { detail: sanitize(detail) } : {}),
    };
    try {
      this.files.appendSecure(this.environment.managerFiles.audit, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      // An unwritable trail must not fail the request that triggered it: refusing a
      // login because the log is full would turn a disk problem into a lockout.
      this.log.warn(`audit write failed for ${event}: ${String(error)}`);
    }
  }

  list(limit = DEFAULT_LIMIT): AuditEntry[] {
    const raw = this.files.readOptional(this.environment.managerFiles.audit);
    if (!raw) {
      return [];
    }
    const entries: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = parseEntry(trimmed);
      if (parsed) {
        entries.push(parsed);
      }
    }
    return entries.toReversed().slice(0, Math.max(1, limit));
  }
}

/**
 * A hand-edited or partially written line is skipped rather than thrown on: the trail is
 * a report, and one bad line must not make the rest unreadable.
 */
function parseEntry(line: string): AuditEntry | undefined {
  try {
    const value = JSON.parse(line) as Partial<AuditEntry>;
    if (typeof value.at !== 'string' || typeof value.event !== 'string') {
      return undefined;
    }
    return {
      at: value.at,
      event: value.event,
      user: typeof value.user === 'string' ? value.user : '',
      ...(value.detail && typeof value.detail === 'object' ? { detail: value.detail } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Drops any key that looks like credential material, whatever the caller intended. */
function sanitize(
  detail: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(detail).filter(([key]) => !FORBIDDEN_DETAIL.has(key)),
  ) as Record<string, string | number | boolean>;
}
