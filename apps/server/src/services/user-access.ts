import { accessSync, constants, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MessageParams } from '@seaveyon/harness-switch-shared';
import { USER_BLOCK_CODES } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { IEnvironmentService, type LocalUser } from './environment';

/**
 * Whether the manager can take over an account, and if not, why.
 *
 * `ok: false` carries a stable `code` for the web UI plus the server's own prose for
 * the CLI, matching how every other reported problem travels.
 */
export type UserAccess =
  | { ok: true }
  | { ok: false; code: string; reason: string; params: MessageParams };

export interface IUserAccessService {
  readonly _serviceBrand: undefined;
  /**
   * Decides whether this process could manage `user`'s configuration if it were selected.
   * Never throws: an account it cannot inspect is reported as blocked, not as a failure.
   */
  inspect(user: LocalUser): UserAccess;
}

export const IUserAccessService = createDecorator<IUserAccessService>('userAccessService');

@inject(IEnvironmentService)
export class UserAccessService implements IUserAccessService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly environment: IEnvironmentService) {}

  inspect(user: LocalUser): UserAccess {
    // The account that launched the service is always manageable: its store is the
    // manager's own, and refusing it would lock the operator out of their own data.
    if (user.username === this.environment.defaultUser.username) {
      return { ok: true };
    }
    // Windows has no uid/gid ownership model and `applyOwner` skips chown entirely
    // there, so the POSIX reasoning below would reject every account for the wrong
    // reason. Fall back to trusting the platform's own access checks.
    if (process.platform === 'win32') {
      return { ok: true };
    }
    if (!existsSync(user.homeDir)) {
      return this.blocked(USER_BLOCK_CODES.homeMissing, `主目录 ${user.homeDir} 不存在`, {
        home: user.homeDir,
      });
    }
    // Every path inside the home is resolved before use, so without search permission
    // even `realPath` fails — the manager could not so much as name a config file.
    if (!can(user.homeDir, constants.X_OK)) {
      return this.blocked(
        USER_BLOCK_CODES.homeUnsearchable,
        `无法进入 ${user.username} 的主目录 ${user.homeDir}`,
        { username: user.username, home: user.homeDir },
      );
    }

    // Writes go through a temp file renamed into place, so it is the containing
    // directory's permissions that decide the outcome, never the target file's. A
    // config file with mode 000 is still replaceable; a writable file inside a
    // read-only directory is not.
    const store = this.storeDir(user);
    const anchor = existsSync(store) ? store : user.homeDir;
    if (!can(anchor, constants.W_OK) || !can(anchor, constants.X_OK)) {
      return anchor === store
        ? this.blocked(
            USER_BLOCK_CODES.storeInaccessible,
            `${user.username} 的配置目录 ${store} 不可写`,
            { username: user.username, path: store },
          )
        : this.blocked(
            USER_BLOCK_CODES.homeUnwritable,
            `${user.username} 的主目录 ${user.homeDir} 不可写`,
            { username: user.username, home: user.homeDir },
          );
    }

    // Even with a writable directory, every file the manager creates is chowned to the
    // target account. Cross-uid chown needs root, so a non-root manager would get as
    // far as writing a temp file and then fail — better to say so before switching.
    if (!this.canOwnAs(user)) {
      return this.blocked(
        USER_BLOCK_CODES.ownershipRequiresRoot,
        `把文件所有权设置为 ${user.username} 需要以 root 运行`,
        { username: user.username },
      );
    }
    return { ok: true };
  }

  /** Mirrors `EnvironmentService.dataDir` for a user that is not the current one. */
  private storeDir(user: LocalUser): string {
    return join(user.homeDir, '.harness-switch');
  }

  /**
   * Whether this process may hand a file to `user`. Ownership is only ever changed to
   * the selected account, so matching uid and gid needs no privilege at all — that is
   * the same condition `FileService.applyOwner` uses to decide a chown failure is fatal.
   */
  private canOwnAs(user: LocalUser): boolean {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined) {
      return true;
    }
    // Root can chown to anyone. Anyone else can only "chown" to themselves, which is
    // a no-op the kernel allows.
    return uid === 0 || (uid === user.uid && gid === user.gid);
  }

  private blocked(code: string, reason: string, params: MessageParams): UserAccess {
    return { ok: false, code, reason, params };
  }
}

/** A denied check and a broken path are the same answer here: not usable. */
function can(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}
