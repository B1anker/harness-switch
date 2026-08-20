import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDecorator } from '../di';

export interface IEnvironmentService {
  readonly _serviceBrand: undefined;
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly homeDir: string;
  readonly publicDir: string;
  readonly sessionTtlMs: number;
  readonly cookieName: string;
  readonly files: {
    profiles: string;
    active: string;
    password: string;
    key: string;
    env: string;
    sessions: string;
    vault: string;
  };
  readonly backupsDir: string;
  readonly backupRetainCount: number;
  /** Config roots of the managed harnesses, honouring each tool's own override var. */
  readonly harnessHomes: {
    claude: string;
    codex: string;
    kimiCode: string;
    piAgent: string;
    dsh: string;
  };
  ensureDataDir(): void;
}

export const IEnvironmentService = createDecorator<IEnvironmentService>('environmentService');

export class EnvironmentService implements IEnvironmentService {
  declare readonly _serviceBrand: undefined;

  readonly host = process.env.HOST || '127.0.0.1';
  readonly port = Number(process.env.PORT || 8787);
  readonly homeDir = process.env.HSW_HOME_DIR || homedir();
  readonly dataDir = process.env.HSW_DATA_DIR || join(this.homeDir, '.harness-switch');
  readonly publicDir = process.env.HSW_PUBLIC_DIR || resolvePublicDir();
  readonly sessionTtlMs = resolveSessionTtlMs();
  readonly cookieName = 'hsw_session';
  readonly files = {
    profiles: join(this.dataDir, 'profiles.json'),
    active: join(this.dataDir, 'active.json'),
    password: join(this.dataDir, 'web_password'),
    key: join(this.dataDir, 'aes-256-gcm.key'),
    env: join(this.dataDir, 'env.sh'),
    sessions: join(this.dataDir, 'sessions.json'),
    vault: join(this.dataDir, 'vault.json'),
  };
  readonly backupsDir = join(this.dataDir, 'backups');
  readonly backupRetainCount = Math.max(1, Number(process.env.HSW_BACKUP_RETAIN || 10));
  readonly harnessHomes = {
    claude: join(this.homeDir, '.claude'),
    codex: process.env.CODEX_HOME || join(this.homeDir, '.codex'),
    kimiCode: process.env.KIMI_CODE_HOME || join(this.homeDir, '.kimi-code'),
    piAgent: process.env.PI_CODING_AGENT_DIR || join(this.homeDir, '.pi', 'agent'),
    dsh: process.env.DSH_HOME || join(this.homeDir, '.dsh'),
  };

  ensureDataDir(): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
  }
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
