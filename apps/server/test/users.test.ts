import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService, type LocalUser } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IProfileService } from '../src/services/profiles';
import { IUserService } from '../src/services/users';
import { IVaultService } from '../src/services/vault';

let rootDir = '';
const originalCodexHome = process.env.CODEX_HOME;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'hsw-users-'));
  process.env.HSW_HOME_DIR = join(rootDir, 'owner');
  process.env.HSW_DATA_DIR = join(rootDir, 'owner', '.harness-switch');
  process.env.CODEX_HOME = join(rootDir, 'owner', '.codex');
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  rmSync(rootDir, { recursive: true, force: true });
});

describe('local Unix users', () => {
  test('keeps each browser session on its own selected user', async () => {
    const { app, firstCookie, secondCookie, owner, peer } = await setup();

    expect((await json(app, '/api/users', firstCookie)).currentUser).toBe(owner.username);
    expect(
      (
        await json(app, `/api/users/${peer.username}/select`, firstCookie, {
          method: 'POST',
        })
      ).currentUser,
    ).toBe(peer.username);
    expect((await json(app, '/api/users', firstCookie)).currentUser).toBe(peer.username);
    expect((await json(app, '/api/users', secondCookie)).currentUser).toBe(owner.username);
  });

  test('copies profiles and vault credentials but not active state', async () => {
    const { app, firstCookie, services, owner, peer } = await setup();
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

    const preview = await json(app, '/api/users/sync/preview', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username }),
    });
    expect(preview).toMatchObject({
      sourceUser: peer.username,
      targetUser: owner.username,
      profileCount: 1,
      providerCount: 1,
      conflicts: [],
    });

    const result = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username, conflictPolicy: 'skip' }),
    });
    expect(result).toMatchObject({ imported: 1, providersCopied: 1 });
    expect(profiles.decrypt('claude', 'peer-main').apiKey).toBe('sk-peer-secret');
    expect(services.get(IAuthService).userForToken(cookieToken(firstCookie))).toBe(owner.username);
    expect(services.get(IFileService).readOptional(environment.files.active)).toBeUndefined();

    const raw = readFileSync(environment.files.profiles, 'utf8');
    expect(raw).not.toContain('sk-peer-secret');
  });

  test('overwrites same-name profiles only for explicitly selected harnesses', async () => {
    const { app, firstCookie, services, peer } = await setup();
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

    const preview = await json(app, '/api/users/sync/preview', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username }),
    });
    expect(preview.conflicts).toEqual([
      { harness: 'claude', name: 'shared' },
      { harness: 'kimi', name: 'shared' },
    ]);

    const result = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        overwriteHarnesses: ['claude'],
      }),
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
    const { app, firstCookie, services, peer } = await setup();
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

    const preview = await json(app, '/api/users/sync/preview', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username }),
    });
    expect(preview.conflicts).toEqual([{ harness: 'claude', name: 'cpa' }]);

    const result = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        overwriteHarnesses: ['claude', ...matchingHarnesses],
      }),
    });
    expect(result).toMatchObject({ overwritten: 1, skipped: 3, providersCopied: 1 });
  });

  test('copies a Codex login cache only with explicit confirmation', async () => {
    const { app, firstCookie, owner, peer } = await setup();
    const sourceAuth = join(peer.homeDir, '.codex', 'auth.json');
    const targetAuth = join(owner.homeDir, '.codex', 'auth.json');
    const sourceCache = '{"tokens":{"access_token":"source-login-session"}}\n';
    mkdirSync(join(peer.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    mkdirSync(join(owner.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    writeFileSync(sourceAuth, sourceCache, { mode: 0o600 });
    writeFileSync(targetAuth, '{"tokens":{"access_token":"target-login-session"}}\n', {
      mode: 0o644,
    });

    const preview = await json(app, '/api/users/sync/preview', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username }),
    });
    expect(preview.codexLoginCache).toEqual({
      available: true,
      targetExists: true,
      migrationNeeded: true,
    });

    const unchanged = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username, conflictPolicy: 'skip' }),
    });
    expect(unchanged.codexLoginCacheMigrated).toBe(false);
    expect(readFileSync(targetAuth, 'utf8')).toContain('target-login-session');

    const migrated = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        migrateCodexLoginCache: true,
      }),
    });
    expect(migrated.codexLoginCacheMigrated).toBe(true);
    expect(readFileSync(sourceAuth, 'utf8')).toBe(sourceCache);
    expect(readFileSync(targetAuth, 'utf8')).toBe(sourceCache);
    expect(statSync(targetAuth).mode & 0o777).toBe(0o600);

    const equivalentCache = '{\n  "tokens": { "access_token": "source-login-session" }\n}\n';
    writeFileSync(targetAuth, equivalentCache, { mode: 0o600 });
    const matchingPreview = await json(app, '/api/users/sync/preview', firstCookie, {
      method: 'POST',
      body: JSON.stringify({ sourceUser: peer.username }),
    });
    expect(matchingPreview.codexLoginCache).toEqual({
      available: true,
      targetExists: true,
      migrationNeeded: false,
    });

    const redundant = await json(app, '/api/users/sync', firstCookie, {
      method: 'POST',
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        migrateCodexLoginCache: true,
      }),
    });
    expect(redundant.codexLoginCacheMigrated).toBe(false);
    expect(readFileSync(targetAuth, 'utf8')).toBe(equivalentCache);
  });

  test('rejects a malformed requested Codex login cache before touching the target', async () => {
    const { app, firstCookie, owner, peer } = await setup();
    const sourceAuth = join(peer.homeDir, '.codex', 'auth.json');
    const targetAuth = join(owner.homeDir, '.codex', 'auth.json');
    mkdirSync(join(peer.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    mkdirSync(join(owner.homeDir, '.codex'), { recursive: true, mode: 0o700 });
    writeFileSync(sourceAuth, '[]\n', { mode: 0o600 });
    writeFileSync(targetAuth, '{"tokens":{"access_token":"keep-me"}}\n', { mode: 0o600 });

    const response = await app.request('/api/users/sync', {
      method: 'POST',
      headers: { Cookie: firstCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        migrateCodexLoginCache: true,
      }),
    });
    expect(response.status).toBe(400);
    expect(readFileSync(targetAuth, 'utf8')).toContain('keep-me');
  });

  test('rejects unknown harness ids in a selective overwrite request', async () => {
    const { app, firstCookie, peer } = await setup();
    const response = await app.request('/api/users/sync', {
      method: 'POST',
      headers: { Cookie: firstCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceUser: peer.username,
        conflictPolicy: 'skip',
        overwriteHarnesses: ['gemini'],
      }),
    });
    expect(response.status).toBe(400);
  });

  test('new files use the selected target user ownership metadata', () => {
    const services = createServices();
    const environment = services.get(IEnvironmentService);
    const files = services.get(IFileService);
    const target: LocalUser = {
      username: 'ownership-test',
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
      homeDir: join(rootDir, 'ownership'),
    };
    environment.runAsUser(target, () => {
      const path = join(target.homeDir, '.claude', 'settings.json');
      files.writeUserFile(path, '{}');
      expect(statSync(path).uid).toBe(target.uid);
      expect(statSync(path).gid).toBe(target.gid);
    });
  });
});

async function setup() {
  const services = createServices();
  const environment = services.get(IEnvironmentService);
  environment.ensureDataDir();
  const owner = environment.defaultUser;
  const peer: LocalUser = {
    username: 'alice-test',
    uid: owner.uid,
    gid: owner.gid,
    homeDir: join(rootDir, 'alice'),
  };
  const users = services.get(IUserService);
  users.list = () => [owner, peer];
  const app = createApp(services);
  const password = services.get(IAuthService).ensurePassword();
  const firstCookie = await login(app, password);
  const secondCookie = await login(app, password);
  return { app, services, owner, peer, firstCookie, secondCookie };
}

async function login(app: ReturnType<typeof createApp>, password: string): Promise<string> {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return response.headers.get('set-cookie') ?? '';
}

async function json(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Record<string, any>> {
  const response = await app.request(path, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  expect(response.status).toBeLessThan(400);
  return (await response.json()) as Record<string, any>;
}

function cookieToken(cookie: string): string {
  return /hsw_session=([^;]+)/.exec(cookie)?.[1] ?? '';
}
