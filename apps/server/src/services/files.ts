import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname } from 'node:path';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { isInside, realPath } from '../common/paths';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';

/**
 * Outcome of an inspection read. `ok` with `content: undefined` means the file is
 * absent; `ok: false` carries why it could not be read.
 */
export type FileReadResult =
  | { ok: true; content: string | undefined }
  | { ok: false; code: string | undefined; reason: string };

export interface IFileService {
  readonly _serviceBrand: undefined;
  exists(file: string): boolean;
  readText(file: string): string;
  /** Returns undefined when the file does not exist, so callers can tell it apart from an empty file. */
  readOptional(file: string): string | undefined;
  /**
   * Reads a file the manager only wants to describe, never to write back. Unlike
   * `readOptional` this never throws: doctor and drift report on files they do not
   * control, so one unreadable file has to become a finding in the report rather than
   * a failed request that hides every other finding.
   */
  readForReport(file: string): FileReadResult;
  /**
   * Reads a file that has to be a regular file. A symlink is refused instead of
   * followed, so content the manager stores for itself cannot be turned into a window
   * onto files the requesting user may not read.
   */
  readRegularOptional(file: string): string | undefined;
  /**
   * Refuses a path that resolves outside the selected user's home and the explicitly
   * configured harness directories. Writes and removes check this on their own; callers
   * that only read a user-supplied destination have to ask for it.
   */
  assertManaged(file: string): void;
  /**
   * Reads a JSON document that may be absent but must be valid when present.
   * A corrupt file is quarantined aside (so a later write can never overwrite
   * the user's data) and a clear error is thrown; the next read then sees the
   * file as missing and uses the fallback.
   */
  readJsonStrict<T>(file: string, fallback: T): T;
  writeSecure(file: string, text: string): void;
  /**
   * Writes a file owned by the user (a harness config) without changing its permissions.
   * New files start at 0600 because they hold API keys.
   */
  writeUserFile(file: string, text: string): void;
  /** Writes a credential-bearing native file as the selected user with mode 0600. */
  writeUserSecretFile(file: string, text: string): void;
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
    } catch (error) {
      // Only a truly absent file means "no content". Permission or I/O errors
      // must surface: treating them as absent could make a write path replace
      // a live config it never even managed to read.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  readForReport(file: string): FileReadResult {
    try {
      return { ok: true, content: readFileSync(file, 'utf8') };
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        return { ok: true, content: undefined };
      }
      return { ok: false, code: errno.code, reason: errno.message };
    }
  }

  readRegularOptional(file: string): string | undefined {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new HttpError(400, `${file} 不是普通文件，拒绝读取`, {
        code: ERROR_CODES.fileNotRegular,
        params: { file },
      });
    }
    return this.readText(file);
  }

  assertManaged(file: string): void {
    const resolved = realPath(file);
    if (this.environment.writeRoots.some((root) => isInside(realPath(root), resolved))) {
      return;
    }
    throw new HttpError(
      403,
      `${file} 解析后落在 ${this.environment.currentUser.username} 的可管理目录之外，拒绝操作`,
      { code: ERROR_CODES.fileOutsideManagedDirectory, params: { file } },
    );
  }

  readJsonStrict<T>(file: string, fallback: T): T {
    if (!existsSync(file)) {
      return fallback;
    }
    let text: string;
    try {
      text = this.readText(file);
    } catch {
      throw new HttpError(500, `数据存储不可读：${file}`, {
        code: ERROR_CODES.storageUnreadable,
        params: { file },
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      const quarantine = `${file}.corrupt-${Date.now()}`;
      try {
        renameSync(file, quarantine);
      } catch {
        throw new HttpError(500, `数据存储损坏且无法隔离：${file}`, {
          code: ERROR_CODES.storageQuarantineFailed,
          params: { file },
        });
      }
      throw new HttpError(
        500,
        `数据存储已损坏，原文件已隔离为 ${basename(quarantine)}，请从备份恢复后再继续`,
        {
          code: ERROR_CODES.storageCorruptQuarantined,
          params: { quarantine: basename(quarantine) },
        },
      );
    }
  }

  writeSecure(file: string, text: string): void {
    this.write(file, text, 0o600);
  }

  writeUserFile(file: string, text: string): void {
    this.write(file, text, this.modeOf(file));
  }

  writeUserSecretFile(file: string, text: string): void {
    this.write(file, text, 0o600, {
      uid: this.environment.currentUser.uid,
      gid: this.environment.currentUser.gid,
    });
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
    this.assertManaged(dir);
    const missing: string[] = [];
    let cursor = dir;
    while (!existsSync(cursor)) {
      missing.push(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const created of missing.toReversed()) {
      this.applyOwner(created, this.environment.currentUser.uid, this.environment.currentUser.gid);
      try {
        chmodSync(created, 0o700);
      } catch {
        // Windows has no POSIX file permissions.
      }
    }
  }

  remove(file: string): void {
    this.assertManaged(file);
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

  private write(file: string, text: string, mode: number, owner = this.ownerOf(file)): void {
    this.assertManaged(file);
    this.ensureDir(dirname(file));
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, text, { encoding: 'utf8', mode });
    this.applyOwner(tmp, owner.uid, owner.gid);
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

  private ownerOf(file: string): { uid: number; gid: number } {
    try {
      const stat = statSync(file);
      return { uid: stat.uid, gid: stat.gid };
    } catch {
      return { uid: this.environment.currentUser.uid, gid: this.environment.currentUser.gid };
    }
  }

  private applyOwner(path: string, uid: number, gid: number): void {
    if (process.platform === 'win32') return;
    try {
      chownSync(path, uid, gid);
    } catch (error) {
      // A non-root process can manage itself without needing chown. Crossing user
      // boundaries must fail clearly instead of leaving root-owned secret files.
      if (uid !== process.getuid?.() || gid !== process.getgid?.()) {
        throw new HttpError(
          403,
          `无法把 ${path} 的所有权设置为 ${this.environment.currentUser.username}，跨用户管理需要以 root 运行`,
          { code: ERROR_CODES.fileOwnershipRequiresRoot, params: { path } },
        );
      }
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  }
}
