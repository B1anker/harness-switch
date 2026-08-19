import { createHash, randomBytes } from 'node:crypto';
import { createDecorator, inject } from '../di';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';

type Session = {
  expires: number;
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

export interface IAuthService {
  readonly _serviceBrand: undefined;
  ensurePassword(): string;
  login(password: string): string | null;
  logout(token: string | undefined): void;
  isAuthenticated(token: string | undefined): boolean;
}

export const IAuthService = createDecorator<IAuthService>('authService');

@inject(IEnvironmentService, IFileService, ICryptoService, ILogService)
export class AuthService implements IAuthService {
  declare readonly _serviceBrand: undefined;

  private sessions: Map<string, Session> | undefined;
  private fingerprint = '';

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly log: ILogService,
  ) {}

  ensurePassword(): string {
    const file = this.environment.files.password;
    if (!this.files.exists(file)) {
      const password = this.crypto.randomPassword();
      this.files.writeSecure(file, `${password}\n`);
      this.log.info(`Initial web password: ${password}`);
    }
    return this.files.readText(file).trim();
  }

  login(password: string): string | null {
    const expected = this.ensurePassword();
    if (!this.crypto.timingSafeEqual(password, expected)) {
      return null;
    }
    const token = randomBytes(32).toString('base64url');
    this.load().set(digest('session', token), {
      expires: Date.now() + this.environment.sessionTtlMs,
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

  /** Reads the table once per process, dropping sessions that expired or predate the password. */
  private load(): Map<string, Session> {
    const loaded = this.sessions;
    if (loaded) {
      return loaded;
    }
    this.fingerprint = digest('password', this.ensurePassword());
    const store = this.files.readJson<SessionStore>(this.environment.files.sessions, {
      version: STORE_VERSION,
      password: this.fingerprint,
      sessions: {},
    });
    const sessions = new Map<string, Session>();
    if (store.version === STORE_VERSION && store.password === this.fingerprint) {
      const now = Date.now();
      for (const [key, session] of Object.entries(store.sessions ?? {})) {
        if (typeof session?.expires === 'number' && session.expires > now) {
          sessions.set(key, { expires: session.expires });
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
    this.files.writeJson(this.environment.files.sessions, {
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
