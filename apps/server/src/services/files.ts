import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';

export interface IFileService {
  readonly _serviceBrand: undefined;
  exists(file: string): boolean;
  readText(file: string): string;
  writeSecure(file: string, text: string): void;
  readJson<T>(file: string, fallback: T): T;
  writeJson(file: string, value: unknown): void;
  ensureDir(dir: string): void;
}

export const IFileService = createDecorator<IFileService>('fileService');

@inject(IEnvironmentService)
export class FileService implements IFileService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly environment: IEnvironmentService) {}

  exists(file: string): boolean {
    return existsSync(file);
  }

  readText(file: string): string {
    return readFileSync(file, 'utf8');
  }

  writeSecure(file: string, text: string): void {
    this.environment.ensureDataDir();
    this.ensureDir(dirname(file));
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
    try {
      chmodSync(file, 0o600);
    } catch {
      // Windows has no POSIX file permissions
    }
  }

  readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(this.readText(file)) as T;
    } catch {
      return fallback;
    }
  }

  writeJson(file: string, value: unknown): void {
    this.writeSecure(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
