import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
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
    // target account. Handing a file to a different uid needs CAP_CHOWN, so a manager
    // without it would get as far as writing a temp file and then fail — better to say
    // so before switching.
    if (!this.canOwnAs(user)) {
      return this.blocked(
        USER_BLOCK_CODES.ownershipRequiresRoot,
        `把文件所有权设置为 ${user.username} 需要以 root 运行或授予 CAP_CHOWN`,
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
   * Whether this process may hand a file to `user`, mirroring what `chown(2)` will
   * actually permit rather than guessing from the uid alone.
   *
   * An unprivileged process may leave the uid untouched and move the file to any group
   * it belongs to; changing the uid at all needs `CAP_CHOWN`. Testing the capability
   * instead of `uid === 0` matters for a service running with file capabilities or
   * inside a container that granted the bit without granting root.
   */
  private canOwnAs(user: LocalUser): boolean {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined) {
      return true;
    }
    // Not a change of ownership at all, so no privilege is involved: the uid already
    // matches and the gid is one this process carries.
    if (uid === user.uid && (gid === user.gid || groupsOf().includes(user.gid))) {
      return true;
    }
    return hasChownCapability(uid);
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

/** Cached because the list cannot change without `setgroups`, which this service never calls. */
let cachedGroups: number[] | undefined;

function groupsOf(): number[] {
  cachedGroups ??= process.getgroups?.() ?? [];
  return cachedGroups;
}

/** `CAP_CHOWN` is capability 0, so it is the low bit of the effective set. */
const CAP_CHOWN_BIT = 1n;

/**
 * Whether this process holds `CAP_CHOWN` and may therefore give a file away to another
 * account. Falls back to the uid when the effective set cannot be read — the case on
 * every non-Linux platform, where `uid === 0` is the only answer available.
 *
 * Cached: capabilities only change through `capset`, which this service never calls.
 */
let cachedChownCapability: boolean | undefined;

function hasChownCapability(uid: number): boolean {
  if (cachedChownCapability === undefined) {
    const effective = readEffectiveCaps();
    cachedChownCapability =
      effective === undefined ? uid === 0 : (effective & CAP_CHOWN_BIT) !== 0n;
  }
  return cachedChownCapability;
}

/** The effective capability set, or `undefined` where procfs cannot answer. */
function readEffectiveCaps(): bigint | undefined {
  try {
    const match = /^CapEff:\s*([0-9a-fA-F]+)$/m.exec(readFileSync('/proc/self/status', 'utf8'));
    return match ? BigInt(`0x${match[1]}`) : undefined;
  } catch {
    return undefined;
  }
}
