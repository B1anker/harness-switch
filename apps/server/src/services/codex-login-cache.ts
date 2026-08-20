import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

const AUTH_FILE = 'auth.json';
const MAX_CACHE_BYTES = 1024 * 1024;

export interface ICodexLoginCacheService {
  readonly _serviceBrand: undefined;
  /** Reports whether the selected user's native login cache is a regular file. */
  exists(): boolean;
  /** Reads and validates the selected user's cache, returning undefined only when absent. */
  readOptional(): string | undefined;
  /** Validates content without writing it, for payload validation before a transaction starts. */
  validate(content: string): void;
  /** Validates the destination and returns its fixed adapter-owned path. */
  prepareWrite(content: string): { path: string; content: string };
  /** Writes a validated cache as the selected user with restrictive permissions. */
  write(content: string): void;
}

export const ICodexLoginCacheService =
  createDecorator<ICodexLoginCacheService>('codexLoginCacheService');

@inject(IEnvironmentService, IFileService)
export class CodexLoginCacheService implements ICodexLoginCacheService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
  ) {}

  exists(): boolean {
    const file = this.path();
    this.assertDirectory(false);
    return this.assertRegularFile(file, false);
  }

  readOptional(): string | undefined {
    const file = this.path();
    this.assertDirectory(false);
    if (!this.assertRegularFile(file, false)) {
      return undefined;
    }
    const content = this.files.readOptional(file);
    if (content === undefined) {
      // The cache disappeared after its lstat. Do not turn that race into a write.
      return undefined;
    }
    this.validate(content);
    return content;
  }

  validate(content: string): void {
    if (Buffer.byteLength(content, 'utf8') > MAX_CACHE_BYTES) {
      throw new HttpError(400, 'Codex 登录缓存过大，拒绝迁移');
    }
    try {
      const value = JSON.parse(content) as unknown;
      if (!isPlainObject(value)) {
        throw new Error('not an object');
      }
    } catch {
      throw new HttpError(400, 'Codex 登录缓存不是有效的 JSON 对象，拒绝迁移');
    }
  }

  prepareWrite(content: string): { path: string; content: string } {
    this.validate(content);
    const directory = this.assertDirectory(true);
    const path = join(directory, AUTH_FILE);
    this.assertRegularFile(path, false);
    return { path, content };
  }

  write(content: string): void {
    const write = this.prepareWrite(content);
    this.files.writeUserSecretFile(write.path, write.content);
  }

  private path(): string {
    return join(this.environment.harnessHomes.codex, AUTH_FILE);
  }

  private assertDirectory(create: boolean): string {
    const directory = this.environment.harnessHomes.codex;
    try {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new HttpError(400, 'Codex 配置目录必须是普通目录，拒绝迁移登录缓存');
      }
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      if (!create) {
        return directory;
      }
      this.files.ensureDir(directory);
      const created = lstatSync(directory);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new HttpError(400, 'Codex 配置目录必须是普通目录，拒绝迁移登录缓存');
      }
      return directory;
    }
  }

  private assertRegularFile(file: string, required: boolean): boolean {
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new HttpError(400, 'Codex 登录缓存必须是普通文件，拒绝迁移');
      }
      if (stat.size > MAX_CACHE_BYTES) {
        throw new HttpError(400, 'Codex 登录缓存过大，拒绝迁移');
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) {
        return false;
      }
      throw error;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
