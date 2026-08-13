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
  readonly sessionTtlMs = 24 * 60 * 60 * 1000;
  readonly cookieName = 'hsw_session';
  readonly files = {
    profiles: join(this.dataDir, 'profiles.json'),
    active: join(this.dataDir, 'active.json'),
    password: join(this.dataDir, 'web_password'),
    key: join(this.dataDir, 'aes-256-gcm.key'),
    env: join(this.dataDir, 'env.sh'),
  };

  ensureDataDir(): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
  }
}

function resolvePublicDir(): string {
  const candidates = [
    join(import.meta.dir, '../public'),
    join(import.meta.dir, '../../public'),
    join(import.meta.dir, 'public'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? candidates[0]!;
}
