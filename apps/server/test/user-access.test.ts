import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { USER_BLOCK_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { IEnvironmentService, type LocalUser } from '../src/services/environment';
import { IUserAccessService } from '../src/services/user-access';
import { createSandbox, type Sandbox } from './support';

let sandbox: Sandbox;
let services: ReturnType<typeof createServices>;

const me = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

/**
 * Whether this test process could actually give a file to another account. Read from the
 * real capability set rather than assumed from the uid, so the expectations stay right
 * both in CI as an ordinary user and in a container that granted CAP_CHOWN.
 */
function canChown(): boolean {
  try {
    const match = /^CapEff:\s*([0-9a-fA-F]+)$/m.exec(readFileSync('/proc/self/status', 'utf8'));
    if (match) return (BigInt(`0x${match[1]}`) & 1n) !== 0n;
  } catch {
    // Not Linux; fall through to the uid.
  }
  return me.uid === 0;
}

beforeEach(() => {
  // The peers live beside the service owner's home, so `owner` keeps the store out of the
  // directories these tests make unreadable.
  sandbox = createSandbox('hsw-access', { owner: 'owner' });
  services = createServices();
});

afterEach(() => {
  // Restore anything made read-only so the tree can be removed.
  for (const dir of ['rostore/.harness-switch', 'rostore', 'rohome']) {
    try {
      chmodSync(sandbox.root(dir), 0o700);
    } catch {
      // Not every test creates every fixture.
    }
  }
  sandbox.dispose();
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
    homeDir: sandbox.root(name),
    ...overrides,
  };
}

function home(name: string, mode?: number): string {
  const dir = sandbox.root(name);
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
    mkdirSync(sandbox.root('rostore', '.harness-switch'), { recursive: true });
    chmodSync(sandbox.root('rostore', '.harness-switch'), 0o500);
    const verdict = access().inspect(peer('rostore'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The home is writable; it is the store the manager would actually write to.
    expect(verdict.code).toBe(USER_BLOCK_CODES.storeInaccessible);
  });

  test('an unreadable config file does not make an account unmanageable', () => {
    // Writes go through a temp file renamed into place, so the directory decides the
    // outcome. Judging by the file's own mode would refuse a switch that works.
    mkdirSync(sandbox.root('badfile', '.harness-switch'), { recursive: true });
    const file = sandbox.root('badfile', '.harness-switch', 'profiles.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o000);
    expect(access().inspect(peer('badfile')).ok).toBe(true);
  });

  test('a foreign uid needs root because every file is chowned to the target', () => {
    home('foreign');
    const verdict = access().inspect(peer('foreign', { uid: me.uid + 4242, gid: me.gid + 4242 }));
    if (canChown()) {
      // Root, or a service granted CAP_CHOWN, can hand a file to anyone.
      expect(verdict.ok).toBe(true);
      return;
    }
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe(USER_BLOCK_CODES.ownershipRequiresRoot);
  });

  test('a group this process already belongs to needs no privilege', () => {
    // `chown(2)` lets an unprivileged caller leave the uid alone and move the file to
    // any of its groups, so demanding an exact gid match would refuse a working switch.
    const supplementary = (process.getgroups?.() ?? []).find((group) => group !== me.gid);
    if (supplementary === undefined) return;
    home('sibling');
    expect(access().inspect(peer('sibling', { gid: supplementary })).ok).toBe(true);
  });

  test('a group this process does not belong to is refused without the capability', () => {
    home('outsider');
    const mine = new Set([me.gid, ...(process.getgroups?.() ?? [])]);
    let foreign = me.gid + 4242;
    while (mine.has(foreign)) foreign += 1;
    const verdict = access().inspect(peer('outsider', { gid: foreign }));
    if (canChown()) {
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
    expect(verdict.params.home).toBe(sandbox.root('ghost'));
  });
});
