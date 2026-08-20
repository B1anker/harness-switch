import { existsSync, readFileSync } from 'node:fs';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IEnvironmentService, type LocalUser } from './environment';

export interface IUserService {
  readonly _serviceBrand: undefined;
  list(): LocalUser[];
  require(username: string): LocalUser;
}

export const IUserService = createDecorator<IUserService>('userService');

@inject(IEnvironmentService)
export class UserService implements IUserService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly environment: IEnvironmentService) {}

  list(): LocalUser[] {
    const users = discoverUsers();
    const existing = users.find((user) => user.username === this.environment.defaultUser.username);
    if (existing) {
      // Test/dev overrides and HSW_HOME_DIR must remain authoritative for the
      // service owner even when /etc/passwd says something different.
      Object.assign(existing, this.environment.defaultUser);
    } else {
      users.push(this.environment.defaultUser);
    }
    const allow = parseAllowList();
    return users
      .filter(
        (user) =>
          user.username === this.environment.defaultUser.username ||
          !allow ||
          allow.has(user.username),
      )
      .toSorted((left, right) => {
        if (left.username === this.environment.defaultUser.username) return -1;
        if (right.username === this.environment.defaultUser.username) return 1;
        return left.uid - right.uid || left.username.localeCompare(right.username);
      });
  }

  require(username: string): LocalUser {
    const normalized = String(username ?? '').trim();
    const user = this.list().find((candidate) => candidate.username === normalized);
    if (!user) {
      throw new HttpError(404, `本地用户 ${normalized || '(empty)'} 不存在或未获准管理`);
    }
    return user;
  }
}

function discoverUsers(): LocalUser[] {
  if (process.platform === 'win32') {
    return [];
  }
  let text = '';
  try {
    text = readFileSync('/etc/passwd', 'utf8');
  } catch {
    return [];
  }
  const uidMin = readUidMin();
  const users: LocalUser[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 7) continue;
    const [username, , uidText, gidText, , homeDir, shell] = fields;
    const uid = Number(uidText);
    const gid = Number(gidText);
    if (
      !username ||
      !homeDir?.startsWith('/') ||
      !Number.isInteger(uid) ||
      !Number.isInteger(gid) ||
      (uid !== 0 && uid < uidMin) ||
      /(?:nologin|false)$/.test(shell ?? '') ||
      !existsSync(homeDir)
    ) {
      continue;
    }
    users.push({ username, uid, gid, homeDir });
  }
  return users;
}

function readUidMin(): number {
  try {
    const match = /^\s*UID_MIN\s+(\d+)/m.exec(readFileSync('/etc/login.defs', 'utf8'));
    return match ? Number(match[1]) : 1000;
  } catch {
    return 1000;
  }
}

function parseAllowList(): Set<string> | undefined {
  const value = process.env.HSW_USERS?.trim();
  return value
    ? new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      )
    : undefined;
}
