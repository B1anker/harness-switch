import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside } from '../common/paths';
import { createDecorator } from '../di';

export type LocalUser = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
};

type EnvironmentFiles = {
  profiles: string;
  active: string;
  password: string;
  key: string;
  env: string;
  sessions: string;
  vault: string;
};

export interface IEnvironmentService {
  readonly _serviceBrand: undefined;
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly managerDataDir: string;
  readonly homeDir: string;
  readonly publicDir: string;
  readonly sessionTtlMs: number;
  readonly cookieName: string;
  readonly files: EnvironmentFiles;
  readonly managerFiles: Pick<EnvironmentFiles, 'password' | 'sessions'>;
  readonly backupsDir: string;
  readonly backupRetainCount: number;
  readonly journalDir: string;
  readonly journalRetainCount: number;
  readonly currentUser: LocalUser;
  readonly defaultUser: LocalUser;
  /**
   * Directories the manager may read or write for the request's selected user. A path
   * that resolves outside all of them is refused, so a symlinked config directory
   * cannot redirect a root-owned write into another account's home.
   */
  readonly writeRoots: string[];
  /** Config roots of the managed harnesses for the request's selected Unix user. */
  readonly harnessHomes: {
    claude: string;
    codex: string;
    kimiCode: string;
    piAgent: string;
    dsh: string;
  };
  ensureDataDir(): void;
  runAsUser<T>(user: LocalUser, callback: () => T): T;
}

export const IEnvironmentService = createDecorator<IEnvironmentService>('environmentService');

export class EnvironmentService implements IEnvironmentService {
  declare readonly _serviceBrand: undefined;

  readonly host = process.env.HOST || '127.0.0.1';
  readonly port = Number(process.env.PORT || 8787);
  readonly publicDir = process.env.HSW_PUBLIC_DIR || resolvePublicDir();
  readonly sessionTtlMs = resolveSessionTtlMs();
  readonly cookieName = 'hsw_session';
  readonly backupRetainCount = Math.max(1, Number(process.env.HSW_BACKUP_RETAIN || 10));
  readonly journalRetainCount = Math.max(1, Number(process.env.HSW_JOURNAL_RETAIN || 50));
  readonly defaultUser = resolveDefaultUser();
  readonly managerDataDir =
    process.env.HSW_DATA_DIR || join(this.defaultUser.homeDir, '.harness-switch');
  readonly managerFiles = {
    password: join(this.managerDataDir, 'web_password'),
    sessions: join(this.managerDataDir, 'sessions.json'),
  };

  private readonly userContext = new AsyncLocalStorage<LocalUser>();

  get currentUser(): LocalUser {
    return this.userContext.getStore() ?? this.defaultUser;
  }

  get homeDir(): string {
    return this.currentUser.homeDir;
  }

  get dataDir(): string {
    // Preserve HSW_DATA_DIR semantics for the service owner so existing installs
    // upgrade in place. Every other Unix user owns an independent store in HOME.
    return this.currentUser.username === this.defaultUser.username
      ? this.managerDataDir
      : join(this.homeDir, '.harness-switch');
  }

  get files(): EnvironmentFiles {
    const dataDir = this.dataDir;
    return {
      profiles: join(dataDir, 'profiles.json'),
      active: join(dataDir, 'active.json'),
      password: join(dataDir, 'web_password'),
      key: join(dataDir, 'aes-256-gcm.key'),
      env: join(dataDir, 'env.sh'),
      sessions: join(dataDir, 'sessions.json'),
      vault: join(dataDir, 'vault.json'),
    };
  }

  get backupsDir(): string {
    return join(this.dataDir, 'backups');
  }

  get journalDir(): string {
    return join(this.dataDir, 'journal');
  }

  get harnessHomes() {
    return {
      claude: join(this.homeDir, '.claude'),
      codex: this.overriddenHome('CODEX_HOME', join(this.homeDir, '.codex')),
      kimiCode: this.overriddenHome('KIMI_CODE_HOME', join(this.homeDir, '.kimi-code')),
      piAgent: this.overriddenHome('PI_CODING_AGENT_DIR', join(this.homeDir, '.pi', 'agent')),
      dsh: this.overriddenHome('DSH_HOME', join(this.homeDir, '.dsh')),
    };
  }

  get writeRoots(): string[] {
    // Home already covers every default location. An env override is set by whoever
    // launched the service, so it stays trusted even when it points outside home.
    const roots = [this.homeDir, this.dataDir, this.managerDataDir];
    for (const home of Object.values(this.harnessHomes)) {
      if (!isInside(this.homeDir, home)) {
        roots.push(home);
      }
    }
    return roots;
  }

  ensureDataDir(): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
  }

  runAsUser<T>(user: LocalUser, callback: () => T): T {
    return this.userContext.run(user, callback);
  }

  /**
   * Process-wide overrides belong to the account that launched the service; applying
   * them to every Unix user would make their files collide.
   */
  private overriddenHome(variable: string, fallback: string): string {
    const override = process.env[variable];
    return this.currentUser.username === this.defaultUser.username && override
      ? override
      : fallback;
  }
}

function resolveDefaultUser(): LocalUser {
  const info = userInfo();
  return {
    username: info.username,
    uid: info.uid,
    gid: info.gid,
    homeDir: process.env.HSW_HOME_DIR || homedir(),
  };
}

/** Falls back to a day when the override is missing or not a positive number. */
function resolveSessionTtlMs(): number {
  const hours = Number(process.env.HSW_SESSION_TTL_HOURS || 24);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

function resolvePublicDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, '../public'),
    join(moduleDir, '../../public'),
    join(moduleDir, 'public'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? candidates[0]!;
}
