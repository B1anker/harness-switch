import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, USER_BLOCK_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService, type LocalUser } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IProfileService } from '../src/services/profiles';
import { IUserService } from '../src/services/users';
import { IVaultService } from '../src/services/vault';
import {
  asSession,
  createSandbox,
  createTestApp,
  loginAgain,
  type Sandbox,
  type TestApp,
} from './support';

let sandbox: Sandbox;

beforeEach(() => {
  // Peers live beside the service owner's home, so `owner` keeps the manager's store out
  // of the directories these tests stand up as other accounts.
  sandbox = createSandbox('hsw-users', {
    owner: 'owner',
    env: (home) => ({ CODEX_HOME: home('.codex') }),
  });
});

afterEach(() => {
  sandbox.dispose();
});

describe('local Unix users', () => {
  test('keeps each browser session on its own selected user', async () => {
    const { first, second, owner, peer } = await setup();

    expect((await first.json<Body>('/api/users')).currentUser).toBe(owner.username);
    expect((await first.postJson<Body>(`/api/users/${peer.username}/select`)).currentUser).toBe(
      peer.username,
    );
    expect((await first.json<Body>('/api/users')).currentUser).toBe(peer.username);
    expect((await second.json<Body>('/api/users')).currentUser).toBe(owner.username);
  });

  test('refuses to switch to a user whose files this process cannot manage', async () => {
    const { first, services, owner } = await setup();
    const users = services.get(IUserService);
    // A peer with no home on disk: the manager could not create its store.
    const stranger: LocalUser = {
      username: 'stranger-test',
      uid: owner.uid,
      gid: owner.gid,
      homeDir: sandbox.root('stranger-missing'),
    };
    users.list = () => [owner, stranger];

    const listed = await first.json<Body>('/api/users');
    expect(listed.items).toMatchObject([
      { username: owner.username, manageable: true },
      { username: stranger.username, manageable: false, blockCode: USER_BLOCK_CODES.homeMissing },
    ]);
    // The reason travels as prose for the CLI and as params for the web UI.
    const blocked = listed.items[1];
    expect(blocked.blockReason).toContain(stranger.homeDir);
    expect(blocked.blockParams).toMatchObject({ home: stranger.homeDir });

    const response = await first.post(`/api/users/${stranger.username}/select`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: ERROR_CODES.userNotSwitchable,
      data: { username: stranger.username },
      msg: expect.any(String),
    });
    // The refusal must not have moved the session.
    expect((await first.json<Body>('/api/users')).currentUser).toBe(owner.username);
  });

  test('copies profiles and vault credentials but not active state', async () => {
    const { first, services, owner, peer } = await setup();
    const environment = services.get(IEnvironmentService);
    const vault = services.get(IVaultService);
    const profiles = services.get(IProfileService);

    environment.runAsUser(peer, () => {
      const provider = vault.create({
        name: 'Shared upstream',
        apiKey: 'sk-peer-secret',
        endpoints: [{ key: 'main', label: 'Main', baseUrl: 'https://peer.example/v1' }],
      });
      profiles.upsert(
        'claude',
        {
          name: 'peer-main',
          providerId: provider.id,
          providerEndpoint: 'main',
          model: 'claude-sonnet',
        },
        true,
      );
    });

    const preview = await first.postJson<Body>('/api/users/sync/preview', {
      sourceUser: peer.username,
    });
    expect(preview).toMatchObject({
      sourceUser: peer.username,
      targetUser: owner.username,
      profileCount: 1,
      providerCount: 1,
      conflicts: [],
    });

    const result = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
    });
    expect(result).toMatchObject({ imported: 1, providersCopied: 1 });
    expect(profiles.decrypt('claude', 'peer-main').apiKey).toBe('sk-peer-secret');
    expect(services.get(IAuthService).userForToken(cookieToken(first.cookie))).toBe(owner.username);
    expect(services.get(IFileService).readOptional(environment.files.active)).toBeUndefined();

    const raw = readFileSync(environment.files.profiles, 'utf8');
    expect(raw).not.toContain('sk-peer-secret');
  });

  test('overwrites same-name profiles only for explicitly selected harnesses', async () => {
    const { first, services, peer } = await setup();
    const environment = services.get(IEnvironmentService);
    const vault = services.get(IVaultService);
    const profiles = services.get(IProfileService);

    profiles.upsert(
      'claude',
      {
        name: 'shared',
        baseUrl: 'https://owner-claude.example/v1',
        apiKey: 'sk-owner-claude',
        model: 'owner-claude',
      },
      true,
    );
    profiles.upsert(
      'kimi',
      {
        name: 'shared',
        baseUrl: 'https://owner-kimi.example/v1',
        apiKey: 'sk-owner-kimi',
        model: 'owner-kimi',
      },
      true,
    );

    environment.runAsUser(peer, () => {
      const provider = vault.create({
        name: 'Peer upstream',
        apiKey: 'sk-peer-provider',
        endpoints: [{ key: 'main', label: 'Main', baseUrl: 'https://peer.example/v1' }],
      });
      profiles.upsert(
        'claude',
        {
          name: 'shared',
          providerId: provider.id,
          providerEndpoint: 'main',
          model: 'peer-claude',
        },
        true,
      );
      profiles.upsert(
        'kimi',
        {
          name: 'shared',
          baseUrl: 'https://peer-kimi.example/v1',
          apiKey: 'sk-peer-kimi',
          model: 'peer-kimi',
        },
        true,
      );
    });

    const preview = await first.postJson<Body>('/api/users/sync/preview', {
      sourceUser: peer.username,
    });
    expect(preview.conflicts).toEqual([
      { harness: 'claude', name: 'shared' },
      { harness: 'kimi', name: 'shared' },
    ]);

    const result = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      overwriteHarnesses: ['claude'],
    });
    expect(result).toMatchObject({ overwritten: 1, skipped: 1, providersCopied: 1 });
    expect(profiles.get('claude', 'shared')).toMatchObject({
      model: 'peer-claude',
      providerEndpoint: 'main',
    });
    expect(profiles.get('claude', 'shared')?.providerId).toBeString();
    expect(profiles.decrypt('claude', 'shared').apiKey).toBe('sk-peer-provider');
    expect(profiles.get('kimi', 'shared')).toMatchObject({ model: 'owner-kimi' });
  });

  test('reports and overwrites only same-name profiles whose content differs', async () => {
    const { first, services, peer } = await setup();
    const environment = services.get(IEnvironmentService);
    const vault = services.get(IVaultService);
    const profiles = services.get(IProfileService);
    const matchingHarnesses = ['kimi', 'pi', 'dsh'] as const;
    const matchingProfile = {
      name: 'gpt',
      baseUrl: 'https://same.example/v1',
      apiKey: 'sk-same-secret',
      model: 'same-model',
    };

    profiles.upsert(
      'claude',
      {
        name: 'cpa',
        baseUrl: 'https://same.example',
        apiKey: 'sk-same-secret',
        model: 'same-model',
      },
      true,
    );
    for (const harness of matchingHarnesses) {
      profiles.upsert(harness, matchingProfile, true);
    }

    environment.runAsUser(peer, () => {
      const provider = vault.create({
        name: 'Shared upstream',
        apiKey: 'sk-same-secret',
        endpoints: [{ key: 'main', label: 'Main', baseUrl: 'https://same.example' }],
      });
      profiles.upsert(
        'claude',
        {
          name: 'cpa',
          providerId: provider.id,
          providerEndpoint: 'main',
          model: 'same-model',
        },
        true,
      );
      for (const harness of matchingHarnesses) {
        profiles.upsert(harness, matchingProfile, true);
      }
    });

    const preview = await first.postJson<Body>('/api/users/sync/preview', {
      sourceUser: peer.username,
    });
    expect(preview.conflicts).toEqual([{ harness: 'claude', name: 'cpa' }]);

    const result = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      overwriteHarnesses: ['claude', ...matchingHarnesses],
    });
    expect(result).toMatchObject({ overwritten: 1, skipped: 3, providersCopied: 1 });
  });

  test('copies a Codex login cache only with explicit confirmation', async () => {
    const { first, owner, peer } = await setup();
    const sourceAuth = join(peer.homeDir, '.codex', 'auth.json');
    const targetAuth = join(owner.homeDir, '.codex', 'auth.json');
    const sourceCache = '{"tokens":{"access_token":"source-login-session"}}\n';
    mkdirSync(join(peer.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    mkdirSync(join(owner.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    writeFileSync(sourceAuth, sourceCache, { mode: 0o600 });
    writeFileSync(targetAuth, '{"tokens":{"access_token":"target-login-session"}}\n', {
      mode: 0o644,
    });

    const preview = await first.postJson<Body>('/api/users/sync/preview', {
      sourceUser: peer.username,
    });
    expect(preview.codexLoginCache).toEqual({
      available: true,
      targetExists: true,
      migrationNeeded: true,
    });

    const unchanged = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
    });
    expect(unchanged.codexLoginCacheMigrated).toBe(false);
    expect(readFileSync(targetAuth, 'utf8')).toContain('target-login-session');

    const migrated = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      migrateCodexLoginCache: true,
    });
    expect(migrated.codexLoginCacheMigrated).toBe(true);
    expect(readFileSync(sourceAuth, 'utf8')).toBe(sourceCache);
    expect(readFileSync(targetAuth, 'utf8')).toBe(sourceCache);
    expect(statSync(targetAuth).mode & 0o777).toBe(0o600);

    const equivalentCache = '{\n  "tokens": { "access_token": "source-login-session" }\n}\n';
    writeFileSync(targetAuth, equivalentCache, { mode: 0o600 });
    const matchingPreview = await first.postJson<Body>('/api/users/sync/preview', {
      sourceUser: peer.username,
    });
    expect(matchingPreview.codexLoginCache).toEqual({
      available: true,
      targetExists: true,
      migrationNeeded: false,
    });

    const redundant = await first.postJson<Body>('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      migrateCodexLoginCache: true,
    });
    expect(redundant.codexLoginCacheMigrated).toBe(false);
    expect(readFileSync(targetAuth, 'utf8')).toBe(equivalentCache);
  });

  test('rejects a malformed requested Codex login cache before touching the target', async () => {
    const { first, owner, peer } = await setup();
    const sourceAuth = join(peer.homeDir, '.codex', 'auth.json');
    const targetAuth = join(owner.homeDir, '.codex', 'auth.json');
    mkdirSync(join(peer.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    mkdirSync(join(owner.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    writeFileSync(sourceAuth, '[]\n', { mode: 0o600 });
    writeFileSync(targetAuth, '{"tokens":{"access_token":"keep-me"}}\n', { mode: 0o600 });

    const response = await first.post('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      migrateCodexLoginCache: true,
    });
    expect(response.status).toBe(400);
    expect(readFileSync(targetAuth, 'utf8')).toContain('keep-me');
  });

  test('rejects unknown harness ids in a selective overwrite request', async () => {
    const { first, peer } = await setup();
    const response = await first.post('/api/users/sync', {
      sourceUser: peer.username,
      conflictPolicy: 'skip',
      overwriteHarnesses: ['gemini'],
    });
    expect(response.status).toBe(400);
  });

  // Root traverses a mode-000 directory, so the EACCES this guards against cannot be
  // staged; the ordering it checks only matters for an unprivileged service anyway.
  test.skipIf((process.getuid?.() ?? 0) === 0)(
    'manager session writes survive a selected user whose home cannot be traversed',
    () => {
      const services = createServices();
      const environment = services.get(IEnvironmentService);
      const files = services.get(IFileService);
      environment.ensureDataDir();
      const blocked: LocalUser = {
        username: 'unreadable-test',
        uid: process.getuid?.() ?? 0,
        gid: process.getgid?.() ?? 0,
        homeDir: sandbox.root('unreadable'),
      };
      mkdirSync(blocked.homeDir, { recursive: true });
      chmodSync(blocked.homeDir, 0o000);
      try {
        // `assertManaged` resolves each write root, and resolving a path under an
        // untraversable home throws EACCES rather than returning a non-match. The
        // manager's own data directory has to be tested before the selected user's,
        // or the session write dies on an account it never needed to look at.
        environment.runAsUser(blocked, () => {
          expect(() => files.assertManaged(environment.managerFiles.sessions)).not.toThrow();
        });
      } finally {
        chmodSync(blocked.homeDir, 0o700);
      }
    },
  );

  test('new files use the selected target user ownership metadata', () => {
    const services = createServices();
    const environment = services.get(IEnvironmentService);
    const files = services.get(IFileService);
    const target: LocalUser = {
      username: 'ownership-test',
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
      homeDir: sandbox.root('ownership'),
    };
    environment.runAsUser(target, () => {
      const path = join(target.homeDir, '.claude', 'settings.json');
      files.writeUserFile(path, '{}');
      expect(statSync(path).uid).toBe(target.uid);
      expect(statSync(path).gid).toBe(target.gid);
    });
  });
});

/** The loosely-typed JSON these routes return; asserted with `toMatchObject` throughout. */
type Body = Record<string, any>;

/**
 * An app with two browser sessions and a switchable second account.
 *
 * The peer is a real directory owned by this process rather than a genuine Unix user, so
 * the access probe reports it as manageable without the suite needing root.
 */
async function setup(): Promise<{
  first: TestApp;
  second: TestApp;
  services: TestApp['services'];
  owner: LocalUser;
  peer: LocalUser;
}> {
  const services = createServices();
  const environment = services.get(IEnvironmentService);
  environment.ensureDataDir();
  const owner = environment.defaultUser;
  const peer: LocalUser = {
    username: 'alice-test',
    uid: owner.uid,
    gid: owner.gid,
    homeDir: sandbox.root('alice'),
  };
  mkdirSync(peer.homeDir, { recursive: true });
  // The user list is stubbed before the app boots, so every route sees the same two.
  services.get(IUserService).list = () => [owner, peer];

  const first = await createTestApp({ services });
  const second = asSession(first, await loginAgain(first));
  return { first, second, services: first.services, owner, peer };
}

function cookieToken(cookie: string): string {
  return /hsw_session=([^;]+)/.exec(cookie)?.[1] ?? '';
}
