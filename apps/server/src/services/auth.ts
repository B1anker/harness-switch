import { createHash, randomBytes } from 'node:crypto';
import { LIMITS } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';

type Session = {
  expires: number;
  username: string;
};

/**
 * On-disk shape of the session table, so a restart does not log everyone out.
 * Tokens are kept as digests: a copied sessions.json cannot be replayed as a cookie. The table is
 * tied to a fingerprint of the password that issued it, so replacing web_password invalidates
 * every session that outlived it.
 */
type SessionStore = {
  version: number;
  password: string;
  sessions: Record<string, Session>;
};

const STORE_VERSION = 1;

/** Rejected until this many ms have passed, after too many wrong guesses. */
export type LockoutState = {
  lockedUntil: number;
  retryAfterSeconds: number;
};

export interface IAuthService {
  readonly _serviceBrand: undefined;
  ensurePassword(): string;
  login(password: string): string | null;
  logout(token: string | undefined): void;
  isAuthenticated(token: string | undefined): boolean;
  userForToken(token: string | undefined): string | undefined;
  selectUser(token: string | undefined, username: string): void;
  /**
   * The active lockout, when guesses are currently refused. Checked before `login` so a
   * throttled caller is told to wait instead of having the password compared at all.
   */
  lockout(): LockoutState | undefined;
  /**
   * Replaces the stored password and invalidates every session but the caller's.
   * Returns false when `currentPassword` does not match.
   */
  changePassword(currentPassword: string, newPassword: string, token: string | undefined): boolean;
}

/** The shortest password the manager will accept on rotation. Shared with the web form. */
export const MIN_PASSWORD_LENGTH = LIMITS.minPassword;

/**
 * Failed-guess budget before the next attempt is refused.
 *
 * The manager binds to loopback by default but the README encourages reaching it over an
 * SSH tunnel, so the login endpoint is worth throttling: `timingSafeEqual` stops an
 * attacker learning the password one character at a time, not one guessing in bulk. The
 * counter is per-process and global rather than per-IP — there is exactly one password,
 * so there is nothing to isolate, and a shared counter cannot be sidestepped by rotating
 * source addresses.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

export const IAuthService = createDecorator<IAuthService>('authService');

@inject(IEnvironmentService, IFileService, ICryptoService, ILogService)
export class AuthService implements IAuthService {
  declare readonly _serviceBrand: undefined;

  private sessions: Map<string, Session> | undefined;
  private fingerprint = '';
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly log: ILogService,
  ) {}

  ensurePassword(): string {
    const file = this.environment.managerFiles.password;
    if (!this.files.exists(file)) {
      const password = this.crypto.randomPassword();
      this.files.writeSecure(file, `${password}\n`);
      this.log.info(`Initial web password: ${password}`);
    }
    const password = this.files.readText(file).trim();
    if (!password) {
      throw new Error(`web password file is empty: ${file}`);
    }
    return password;
  }

  lockout(): LockoutState | undefined {
    const remaining = this.lockedUntil - Date.now();
    if (remaining <= 0) {
      return undefined;
    }
    return { lockedUntil: this.lockedUntil, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  login(password: string): string | null {
    if (this.lockout()) {
      return null;
    }
    const expected = this.ensurePassword();
    if (!this.crypto.timingSafeEqual(password, expected)) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.lockedUntil = Date.now() + LOCKOUT_MS;
        this.failedAttempts = 0;
        // Worth a line in the log: on a single-password service this is the only
        // signal that someone is guessing, and it names no secret.
        this.log.warn(`web login locked for ${LOCKOUT_MS / 1000}s after repeated failures`);
      }
      return null;
    }
    this.failedAttempts = 0;
    return this.issue();
  }

  changePassword(currentPassword: string, newPassword: string, token: string | undefined): boolean {
    if (!this.crypto.timingSafeEqual(currentPassword, this.ensurePassword())) {
      return false;
    }
    const survivor = token ? this.load().get(digest('session', token)) : undefined;
    this.files.writeSecure(this.environment.managerFiles.password, `${newPassword}\n`);

    // The table is keyed to a fingerprint of the password that issued it, so rewriting
    // the file already invalidates every session. Rebuild it around the caller's own so
    // the operator who just rotated the password is not logged out by their own action.
    this.fingerprint = digest('password', newPassword);
    const sessions = new Map<string, Session>();
    if (token && survivor) {
      sessions.set(digest('session', token), survivor);
    }
    this.sessions = sessions;
    this.persist();
    return true;
  }

  private issue(): string {
    const token = randomBytes(32).toString('base64url');
    this.load().set(digest('session', token), {
      expires: Date.now() + this.environment.sessionTtlMs,
      username: this.environment.defaultUser.username,
    });
    this.persist();
    return token;
  }

  logout(token: string | undefined): void {
    if (token && this.load().delete(digest('session', token))) {
      this.persist();
    }
  }

  isAuthenticated(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    const sessions = this.load();
    const key = digest('session', token);
    const session = sessions.get(key);
    if (!session || session.expires < Date.now()) {
      if (sessions.delete(key)) {
        this.persist();
      }
      return false;
    }
    return true;
  }

  userForToken(token: string | undefined): string | undefined {
    if (!this.isAuthenticated(token) || !token) {
      return undefined;
    }
    return this.load().get(digest('session', token))?.username;
  }

  selectUser(token: string | undefined, username: string): void {
    if (!this.isAuthenticated(token) || !token) {
      return;
    }
    const session = this.load().get(digest('session', token));
    if (session) {
      session.username = username;
      this.persist();
    }
  }

  /** Reads the table once per process, dropping sessions that expired or predate the password. */
  private load(): Map<string, Session> {
    const loaded = this.sessions;
    if (loaded) {
      return loaded;
    }
    this.fingerprint = digest('password', this.ensurePassword());
    const store = this.files.readJson<SessionStore>(this.environment.managerFiles.sessions, {
      version: STORE_VERSION,
      password: this.fingerprint,
      sessions: {},
    });
    const sessions = new Map<string, Session>();
    if (store.version === STORE_VERSION && store.password === this.fingerprint) {
      const now = Date.now();
      for (const [key, session] of Object.entries(store.sessions ?? {})) {
        if (typeof session?.expires === 'number' && session.expires > now) {
          sessions.set(key, {
            expires: session.expires,
            username:
              typeof session.username === 'string'
                ? session.username
                : this.environment.defaultUser.username,
          });
        }
      }
    }
    this.sessions = sessions;
    if (sessions.size > 0) {
      this.log.info(`restored ${sessions.size} web session(s)`);
    }
    return sessions;
  }

  private persist(): void {
    const sessions = this.sessions;
    if (!sessions) {
      return;
    }
    this.files.writeJson(this.environment.managerFiles.sessions, {
      version: STORE_VERSION,
      password: this.fingerprint,
      sessions: Object.fromEntries(sessions),
    } satisfies SessionStore);
  }
}

/** Domain-separated so a password fingerprint can never collide with a token digest. */
function digest(kind: 'password' | 'session', value: string): string {
  return createHash('sha256').update(`${kind}:${value}`).digest('base64url');
}
