import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
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
  readonly currentUser: LocalUser;
  readonly defaultUser: LocalUser;
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

  get harnessHomes() {
    const isDefault = this.currentUser.username === this.defaultUser.username;
    return {
      claude: join(this.homeDir, '.claude'),
      // Process-wide overrides belong to the account that launched the service;
      // applying them to every Unix user would make their files collide.
      codex:
        isDefault && process.env.CODEX_HOME ? process.env.CODEX_HOME : join(this.homeDir, '.codex'),
      kimiCode:
        isDefault && process.env.KIMI_CODE_HOME
          ? process.env.KIMI_CODE_HOME
          : join(this.homeDir, '.kimi-code'),
      piAgent:
        isDefault && process.env.PI_CODING_AGENT_DIR
          ? process.env.PI_CODING_AGENT_DIR
          : join(this.homeDir, '.pi', 'agent'),
      dsh: isDefault && process.env.DSH_HOME ? process.env.DSH_HOME : join(this.homeDir, '.dsh'),
    };
  }

  ensureDataDir(): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
  }

  runAsUser<T>(user: LocalUser, callback: () => T): T {
    return this.userContext.run(user, callback);
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
  const candidates = [
    join(import.meta.dir, '../public'),
    join(import.meta.dir, '../../public'),
    join(import.meta.dir, 'public'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? candidates[0]!;
}
