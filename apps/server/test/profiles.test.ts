import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { ICryptoService } from '../src/services/crypto';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IProfileService } from '../src/services/profiles';
import { expectHttpError } from './support/http-error';

let homeDir = '';
let services: ReturnType<typeof createServices>;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-profiles-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  rmSync(homeDir, { recursive: true, force: true });
});

function create(name: string, extra: Record<string, unknown> = {}) {
  return services.get(IProfileService).upsert(
    'claude',
    {
      name,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-original',
      model: 'claude-sonnet-4-5',
      notes: 'a note',
      ...extra,
    },
    true,
  );
}

describe('profile storage', () => {
  test('never writes the api key in the clear', () => {
    create('main');
    const raw = services
      .get(IFileService)
      .readText(services.get(IEnvironmentService).files.profiles);

    expect(raw).not.toContain('sk-original');
    expect(services.get(IProfileService).decrypt('claude', 'main').apiKey).toBe('sk-original');
  });

  test('keeps the profile store readable only by its owner', () => {
    create('main');
    const file = services.get(IEnvironmentService).files.profiles;
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test('omitting the api key on update keeps the stored one', () => {
    const profiles = services.get(IProfileService);
    create('main');
    profiles.upsert('claude', { name: 'main', model: 'glm-4.6' }, false);

    const updated = profiles.decrypt('claude', 'main');
    expect(updated.apiKey).toBe('sk-original');
    expect(updated.model).toBe('glm-4.6');
    // Fields left out of the patch keep their previous values.
    expect(updated.baseUrl).toBe('https://api.example.com/v1');
  });

  test('replacing the api key re-encrypts it', () => {
    const profiles = services.get(IProfileService);
    create('main');
    profiles.upsert('claude', { name: 'main', apiKey: 'sk-rotated' }, false);
    expect(profiles.decrypt('claude', 'main').apiKey).toBe('sk-rotated');
  });

  test('renames a profile without losing its encrypted values', () => {
    const profiles = services.get(IProfileService);
    create('main');
    const renamed = profiles.upsert(
      'claude',
      { name: 'renamed', sourceName: 'main', notes: 'kept' },
      false,
    );

    expect(renamed.name).toBe('renamed');
    expect(profiles.get('claude', 'main')).toBeUndefined();
    expect(profiles.decrypt('claude', 'renamed').apiKey).toBe('sk-original');
    expect(profiles.get('claude', 'renamed')?.notes).toBe('kept');
  });

  test('copies a profile without exposing or re-entering its credential', () => {
    const profiles = services.get(IProfileService);
    create('main', { extras: { authVar: 'ANTHROPIC_API_KEY' }, overrides: { settings: '{}' } });

    const copy = profiles.upsert(
      'claude',
      { name: 'main-copy', copySourceName: 'main', model: 'glm-4.6' },
      true,
    );

    expect(copy.name).toBe('main-copy');
    expect(profiles.decrypt('claude', 'main-copy')).toMatchObject({
      apiKey: 'sk-original',
      baseUrl: 'https://api.example.com/v1',
      model: 'glm-4.6',
      extras: { authVar: 'ANTHROPIC_API_KEY' },
      overrides: {},
    });
  });

  test('reports the usual conflicts instead of overwriting silently', () => {
    const profiles = services.get(IProfileService);
    create('main');

    expect(() => create('main')).toThrow(/already exists/);
    expect(() => profiles.upsert('claude', { name: 'ghost' }, false)).toThrow(/not found/);
    expect(() => profiles.decrypt('claude', 'ghost')).toThrow(/not found/);
    expect(() => profiles.remove('claude', 'ghost')).toThrow(/not found/);
  });

  test('rejects names that would escape the store or the ui', () => {
    const profiles = services.get(IProfileService);
    expect(() => profiles.upsert('claude', { name: '  ' }, true)).toThrow(/name is required/);
    expect(() => profiles.upsert('claude', { name: 'a/b' }, true)).toThrow(/slashes/);
    expect(() => profiles.upsert('claude', { name: 'a\\b' }, true)).toThrow(/slashes/);
    expect(() => profiles.upsert('claude', { name: 'x'.repeat(121) }, true)).toThrow(/too long/);
  });

  test('requires an api key when creating but not when editing', () => {
    const profiles = services.get(IProfileService);
    expect(() => profiles.upsert('claude', { name: 'main', baseUrl: 'https://a' }, true)).toThrow(
      /apiKey is required/,
    );
  });

  test('lets the adapter refuse a profile it could not express', () => {
    const profiles = services.get(IProfileService);
    expectHttpError(
      () => profiles.upsert('kimi', { name: 'main', baseUrl: 'https://a', apiKey: 'sk' }, true),
      ERROR_CODES.adapterModelRequired,
      400,
    );
  });

  test('defaults extras and overrides so adapters never see undefined', () => {
    const created = create('main');
    expect(created.extras).toEqual({});
    expect(created.overriddenTargets).toEqual([]);

    const decrypted = services.get(IProfileService).decrypt('claude', 'main');
    expect(decrypted.extras).toEqual({});
    expect(decrypted.overrides).toEqual({});
  });

  test('exposes which files the user took over without leaking their content', () => {
    create('main', { overrides: { settings: '{"env":{}}' } });
    const listed = services.get(IProfileService).list('claude')[0];

    expect(listed?.overriddenTargets).toEqual(['settings']);
    expect(JSON.stringify(listed)).not.toContain('"env"');
  });

  test('reading a profile store from an older layout does not crash', () => {
    const environment = services.get(IEnvironmentService);
    services.get(IFileService).writeJson(environment.files.profiles, {
      claude: {
        legacy: {
          base_url: 'https://old',
          api_key: {},
          model: '',
          notes: '',
          updated_at: '',
        },
      },
    });

    const listed = services.get(IProfileService).list('claude')[0];
    expect(listed?.name).toBe('legacy');
    expect(listed?.extras).toEqual({});
    // An unreadable key decrypts to empty rather than throwing.
    expect(services.get(IProfileService).decrypt('claude', 'legacy').apiKey).toBe('');
  });
});

describe('backfill', () => {
  test('updates the values a live file can hold', () => {
    const profiles = services.get(IProfileService);
    create('main');
    profiles.applyBackfill('claude', 'main', {
      baseUrl: 'https://edited',
      model: 'glm-4.6',
      apiKey: 'sk-edited',
    });

    const stored = profiles.decrypt('claude', 'main');
    expect(stored.baseUrl).toBe('https://edited');
    expect(stored.model).toBe('glm-4.6');
    expect(stored.apiKey).toBe('sk-edited');
  });

  test('leaves fields alone that a live file cannot express', () => {
    const profiles = services.get(IProfileService);
    create('main', { extras: { authVar: 'ANTHROPIC_API_KEY' }, overrides: { settings: '{}' } });
    profiles.applyBackfill('claude', 'main', { baseUrl: 'https://edited' });

    const listed = profiles.list('claude')[0];
    // Wiping these would show empty values in the editor and erase them on the next save.
    expect(listed?.notes).toBe('a note');
    expect(listed?.extras.authVar).toBe('ANTHROPIC_API_KEY');
    expect(listed?.overriddenTargets).toEqual(['settings']);
  });

  test('an empty key from a live file does not erase the stored one', () => {
    const profiles = services.get(IProfileService);
    create('main');
    profiles.applyBackfill('claude', 'main', { apiKey: '' });
    expect(profiles.decrypt('claude', 'main').apiKey).toBe('sk-original');
  });

  test('a profile deleted meanwhile is skipped rather than resurrected', () => {
    const profiles = services.get(IProfileService);
    profiles.applyBackfill('claude', 'gone', { baseUrl: 'https://edited' });
    expect(profiles.list('claude')).toEqual([]);
  });
});

describe('crypto', () => {
  test('detects a tampered payload instead of returning wrong plaintext', () => {
    const crypto = services.get(ICryptoService);
    const encrypted = crypto.encrypt('sk-secret');
    expect(crypto.decrypt(encrypted)).toBe('sk-secret');

    expect(crypto.decrypt({ ...encrypted, data: `${encrypted.data}00` })).toBe('');
    expect(crypto.decrypt({ iv: 'x', tag: 'y', data: 'z' })).toBe('');
    expect(crypto.decrypt({})).toBe('');
  });

  test('uses a fresh nonce for every value', () => {
    const crypto = services.get(ICryptoService);
    expect(crypto.encrypt('same').iv).not.toBe(crypto.encrypt('same').iv);
  });

  test('compares secrets without leaking length through early exit', () => {
    const crypto = services.get(ICryptoService);
    expect(crypto.timingSafeEqual('token', 'token')).toBe(true);
    expect(crypto.timingSafeEqual('token', 'other')).toBe(false);
    expect(crypto.timingSafeEqual('token', 'token-longer')).toBe(false);
  });
});

describe('file service', () => {
  test('tells an absent file apart from an empty one', () => {
    const files = services.get(IFileService);
    const file = join(homeDir, 'maybe.txt');

    expect(files.readOptional(file)).toBeUndefined();
    files.writeUserFile(file, '');
    expect(files.readOptional(file)).toBe('');
  });

  test('leaves no temporary files behind', () => {
    const files = services.get(IFileService);
    const dir = join(homeDir, 'writes');
    files.writeUserFile(join(dir, 'a.json'), '{}');

    expect(files.listDirectories(homeDir)).toContain('writes');
    expect(Bun.spawnSync(['ls', dir]).stdout.toString().trim()).toBe('a.json');
  });

  test('removing is idempotent and works on directories', () => {
    const files = services.get(IFileService);
    const dir = join(homeDir, 'tree');
    files.writeUserFile(join(dir, 'a.json'), '{}');

    files.remove(dir);
    files.remove(dir);
    expect(files.exists(dir)).toBe(false);
    expect(files.listDirectories(join(homeDir, 'missing'))).toEqual([]);
  });

  test('falls back instead of throwing on unreadable json', () => {
    const files = services.get(IFileService);
    const file = join(homeDir, 'broken.json');
    files.writeUserFile(file, '{ nope');

    expect(files.readJson(file, { fallback: true })).toEqual({ fallback: true });
    expect(files.readJson(join(homeDir, 'absent.json'), null)).toBeNull();
  });

  test('readOptional rethrows non-ENOENT errors instead of reporting an absent file', () => {
    const files = services.get(IFileService);
    const blocked = join(homeDir, 'blocked');
    files.writeUserFile(blocked, 'not a directory');

    expect(() => files.readOptional(join(blocked, 'config.json'))).toThrow();
  });

  test('readJsonStrict returns the fallback only when the file is absent', () => {
    const files = services.get(IFileService);
    expect(files.readJsonStrict(join(homeDir, 'absent.json'), { fallback: true })).toEqual({
      fallback: true,
    });
  });

  test('readJsonStrict quarantines a corrupt store instead of silently dropping it', () => {
    const files = services.get(IFileService);
    const file = join(homeDir, 'store.json');
    files.writeUserFile(file, '{ nope');

    expectHttpError(
      () => files.readJsonStrict(file, { fallback: true }),
      ERROR_CODES.storageCorruptQuarantined,
    );
    expect(files.exists(file)).toBe(false);
    const quarantined = readdirSync(homeDir).find((name) => name.startsWith('store.json.corrupt-'));
    expect(quarantined).toBeDefined();
    expect(files.readOptional(join(homeDir, quarantined as string))).toBe('{ nope');
    // The next read is clean, so the service recovers instead of bricking.
    expect(files.readJsonStrict(file, { fallback: true })).toEqual({ fallback: true });
  });

  test('a corrupt profile store fails closed instead of being overwritten as empty', () => {
    const profiles = services.get(IProfileService);
    const store = join(homeDir, '.harness-switch', 'profiles.json');
    services.get(IFileService).writeUserFile(store, '{ nope');

    expectHttpError(() => profiles.list('claude'), ERROR_CODES.storageCorruptQuarantined);
    expect(services.get(IFileService).exists(store)).toBe(false);
  });
});
