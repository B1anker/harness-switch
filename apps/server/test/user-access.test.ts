import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USER_BLOCK_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { IEnvironmentService, type LocalUser } from '../src/services/environment';
import { IUserAccessService } from '../src/services/user-access';

let rootDir = '';
let services: ReturnType<typeof createServices>;

const me = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'hsw-access-'));
  process.env.HSW_HOME_DIR = join(rootDir, 'owner');
  process.env.HSW_DATA_DIR = join(rootDir, 'owner', '.harness-switch');
  mkdirSync(join(rootDir, 'owner'), { recursive: true });
  services = createServices();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  // Restore anything made read-only so the tree can be removed.
  for (const dir of ['rostore/.harness-switch', 'rostore', 'rohome']) {
    try {
      chmodSync(join(rootDir, dir), 0o700);
    } catch {
      // Not every test creates every fixture.
    }
  }
  rmSync(rootDir, { recursive: true, force: true });
});

function access() {
  return services.get(IUserAccessService);
}

/** A peer that looks like another account but is owned by the running process. */
function peer(name: string, overrides: Partial<LocalUser> = {}): LocalUser {
  return {
    username: name,
    uid: me.uid,
    gid: me.gid,
    homeDir: join(rootDir, name),
    ...overrides,
  };
}

function home(name: string, mode?: number): string {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  if (mode !== undefined) chmodSync(dir, mode);
  return dir;
}

describe('user access probe', () => {
  test('a writable home owned by this process is manageable', () => {
    home('plain');
    expect(access().inspect(peer('plain')).ok).toBe(true);
  });

  test('the service owner is always manageable', () => {
    const environment = services.get(IEnvironmentService);
    // Even pointed at a directory it could never touch: refusing the account that
    // launched the service would lock the operator out of their own store.
    const verdict = access().inspect({ ...environment.defaultUser, homeDir: '/proc/1/root' });
    expect(verdict.ok).toBe(true);
  });

  test('an account whose home is gone is not manageable', () => {
    const verdict = access().inspect(peer('ghost'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe(USER_BLOCK_CODES.homeMissing);
  });

  test('a home that cannot be written is not manageable', () => {
    home('rohome', 0o500);
    const verdict = access().inspect(peer('rohome'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe(USER_BLOCK_CODES.homeUnwritable);
  });

  test('an existing but read-only store directory is not manageable', () => {
    mkdirSync(join(rootDir, 'rostore', '.harness-switch'), { recursive: true });
    chmodSync(join(rootDir, 'rostore', '.harness-switch'), 0o500);
    const verdict = access().inspect(peer('rostore'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The home is writable; it is the store the manager would actually write to.
    expect(verdict.code).toBe(USER_BLOCK_CODES.storeInaccessible);
  });

  test('an unreadable config file does not make an account unmanageable', () => {
    // Writes go through a temp file renamed into place, so the directory decides the
    // outcome. Judging by the file's own mode would refuse a switch that works.
    mkdirSync(join(rootDir, 'badfile', '.harness-switch'), { recursive: true });
    const file = join(rootDir, 'badfile', '.harness-switch', 'profiles.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o000);
    expect(access().inspect(peer('badfile')).ok).toBe(true);
  });

  test('a foreign uid needs root because every file is chowned to the target', () => {
    home('foreign');
    const verdict = access().inspect(peer('foreign', { uid: me.uid + 4242, gid: me.gid + 4242 }));
    if (me.uid === 0) {
      // Root can chown to anyone, so this is genuinely manageable.
      expect(verdict.ok).toBe(true);
      return;
    }
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe(USER_BLOCK_CODES.ownershipRequiresRoot);
  });

  test('a block carries prose and params for the CLI and the web UI', () => {
    const verdict = access().inspect(peer('ghost'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason.length).toBeGreaterThan(0);
    expect(verdict.params.home).toBe(join(rootDir, 'ghost'));
  });
});
