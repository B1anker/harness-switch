import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';

export interface IFileService {
  readonly _serviceBrand: undefined;
  exists(file: string): boolean;
  readText(file: string): string;
  /** Returns undefined when the file does not exist, so callers can tell it apart from an empty file. */
  readOptional(file: string): string | undefined;
  writeSecure(file: string, text: string): void;
  /**
   * Writes a file owned by the user (a harness config) without changing its permissions.
   * New files start at 0600 because they hold API keys.
   */
  writeUserFile(file: string, text: string): void;
  readJson<T>(file: string, fallback: T): T;
  writeJson(file: string, value: unknown): void;
  ensureDir(dir: string): void;
  remove(file: string): void;
  listDirectories(dir: string): string[];
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

  readOptional(file: string): string | undefined {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  }

  writeSecure(file: string, text: string): void {
    this.environment.ensureDataDir();
    this.write(file, text, 0o600);
  }

  writeUserFile(file: string, text: string): void {
    this.write(file, text, this.modeOf(file));
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

  remove(file: string): void {
    rmSync(file, { force: true, recursive: true });
  }

  listDirectories(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private write(file: string, text: string, mode: number): void {
    this.ensureDir(dirname(file));
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, text, { encoding: 'utf8', mode });
    renameSync(tmp, file);
    try {
      chmodSync(file, mode);
    } catch {
      // Windows has no POSIX file permissions
    }
  }

  /** Keeps an existing file's permissions; new files hold secrets so they start at 0600. */
  private modeOf(file: string): number {
    try {
      return statSync(file).mode & 0o777;
    } catch {
      return 0o600;
    }
  }
}
