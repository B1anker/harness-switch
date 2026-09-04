import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import type { InstantiationService } from '../src/di';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IProfileService } from '../src/services/profiles';
import { IVaultService } from '../src/services/vault';
import { createSandbox, createTestServices, expectHttpError, type Sandbox } from './support';

let sandbox: Sandbox;
let services: InstantiationService;

beforeEach(() => {
  sandbox = createSandbox('hsw-vault');
  services = createTestServices();
});

afterEach(() => {
  sandbox.dispose();
});

function vault() {
  return services.get(IVaultService);
}

function profiles() {
  return services.get(IProfileService);
}

function createProvider(extra: Record<string, unknown> = {}) {
  return vault().create({
    name: 'acme',
    apiKey: 'sk-acme',
    endpoints: [
      { key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' },
      { key: 'eu', label: 'EU', baseUrl: 'https://eu.acme.example/v1' },
    ],
    ...extra,
  });
}

describe('provider vault', () => {
  test('never writes the api key in the clear and stores 0600', () => {
    createProvider();
    const raw = services.get(IFileService).readText(services.get(IEnvironmentService).files.vault);
    expect(raw).not.toContain('sk-acme');
    const mode = statSync(services.get(IEnvironmentService).files.vault).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(vault().decrypt('acme')).toBe('sk-acme');
  });

  test('list and get never expose the plaintext credential', () => {
    createProvider();
    expect(JSON.stringify(vault().list())).not.toContain('sk-acme');
    expect(JSON.stringify(vault().get('acme'))).not.toContain('sk-acme');
    expect(
      vault()
        .get('acme')
        .endpoints.map((endpoint) => endpoint.key),
    ).toEqual(['default', 'eu']);
    expect(vault().get('acme').apiKeyConfigured).toBe(true);
  });

  test('rejects duplicate endpoint keys and missing base urls', () => {
    expect(() =>
      vault().create({
        name: 'dup',
        apiKey: 'sk',
        endpoints: [
          { key: 'a', label: 'A', baseUrl: 'https://a' },
          { key: 'a', label: 'A2', baseUrl: 'https://b' },
        ],
      }),
    ).toThrow(/duplicate endpoint/);
    expect(() =>
      vault().create({
        name: 'nobase',
        apiKey: 'sk',
        endpoints: [{ key: 'a', label: 'A', baseUrl: '' }],
      }),
    ).toThrow(/baseUrl/);
  });

  test('rotation re-encrypts the entry', () => {
    createProvider();
    vault().update('acme', { apiKey: 'sk-rotated' });
    expect(vault().decrypt('acme')).toBe('sk-rotated');
    const raw = services.get(IFileService).readText(services.get(IEnvironmentService).files.vault);
    expect(raw).not.toContain('sk-rotated');
  });

  test('delete is refused while a profile references the entry', () => {
    createProvider();
    profiles().upsert(
      'claude',
      { name: 'via-vault', baseUrl: 'https://x', providerId: 'acme', providerEndpoint: 'eu' },
      true,
    );
    expect(vault().references('acme')).toEqual([{ harness: 'claude', name: 'via-vault' }]);
    const inUse = expectHttpError(() => vault().remove('acme'), ERROR_CODES.providerInUse, 409);
    expect(inUse.params).toEqual({ count: 1 });
    profiles().remove('claude', 'via-vault');
    vault().remove('acme');
    expect(() => vault().get('acme')).toThrow(/not found/);
  });

  test('a corrupt vault store fails closed instead of being overwritten as empty', () => {
    const file = services.get(IEnvironmentService).files.vault;
    services.get(IFileService).writeUserFile(file, '{ nope');
    expectHttpError(() => vault().list(), ERROR_CODES.storageCorruptQuarantined);
    expect(services.get(IFileService).exists(file)).toBe(false);
  });
});

describe('profiles referencing the vault', () => {
  test('decrypt resolves the vault key and the endpoint base url', () => {
    createProvider();
    profiles().upsert(
      'claude',
      {
        name: 'via-vault',
        baseUrl: 'https://ignored',
        providerId: 'acme',
        providerEndpoint: 'eu',
      },
      true,
    );
    const decrypted = profiles().decrypt('claude', 'via-vault');
    expect(decrypted.apiKey).toBe('sk-acme');
    expect(decrypted.baseUrl).toBe('https://eu.acme.example/v1');
    const listed = profiles().list('claude')[0];
    expect(listed?.providerId).toBe('acme');
    expect(listed?.providerEndpoint).toBe('eu');
  });

  test('a provider reference without an endpoint keeps the profile base url', () => {
    createProvider();
    profiles().upsert(
      'claude',
      { name: 'bare', baseUrl: 'https://own.example/v1', providerId: 'acme' },
      true,
    );
    const decrypted = profiles().decrypt('claude', 'bare');
    expect(decrypted.apiKey).toBe('sk-acme');
    expect(decrypted.baseUrl).toBe('https://own.example/v1');
    expect(profiles().list('claude')[0]?.providerEndpoint).toBeUndefined();
  });

  test('rotating the vault entry updates every referencing profile immediately', () => {
    createProvider();
    profiles().upsert('claude', { name: 'a', baseUrl: 'https://x', providerId: 'acme' }, true);
    profiles().upsert('claude', { name: 'b', baseUrl: 'https://y', providerId: 'acme' }, true);
    vault().update('acme', { apiKey: 'sk-rotated' });
    expect(profiles().decrypt('claude', 'a').apiKey).toBe('sk-rotated');
    expect(profiles().decrypt('claude', 'b').apiKey).toBe('sk-rotated');
    // The cached copy in profiles.json is refreshed too.
    const raw = services
      .get(IFileService)
      .readText(services.get(IEnvironmentService).files.profiles);
    expect(raw).not.toContain('sk-rotated');
  });

  test('changing an endpoint base url is reflected in referencing profiles', () => {
    createProvider();
    profiles().upsert(
      'claude',
      { name: 'a', baseUrl: 'https://x', providerId: 'acme', providerEndpoint: 'eu' },
      true,
    );
    vault().update('acme', {
      endpoints: [
        { key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' },
        { key: 'eu', label: 'EU', baseUrl: 'https://eu2.acme.example/v1' },
      ],
    });
    expect(profiles().decrypt('claude', 'a').baseUrl).toBe('https://eu2.acme.example/v1');
  });

  test('repairs a removed endpoint reference to the first remaining endpoint', () => {
    createProvider();
    profiles().upsert(
      'claude',
      { name: 'a', baseUrl: 'https://x', providerId: 'acme', providerEndpoint: 'eu' },
      true,
    );
    vault().update('acme', {
      endpoints: [{ key: 'default', baseUrl: 'https://api.acme.example/v2' }],
    });
    expect(profiles().list('claude')[0]?.providerEndpoint).toBe('default');
    expect(profiles().decrypt('claude', 'a').baseUrl).toBe('https://api.acme.example/v2');
  });

  test('explicit empty providerId detaches the profile keeping the cached key', () => {
    createProvider();
    profiles().upsert('claude', { name: 'a', baseUrl: 'https://x', providerId: 'acme' }, true);
    const detached = profiles().upsert('claude', { name: 'a', providerId: '' }, false);
    expect(detached.providerId).toBeUndefined();
    expect(profiles().decrypt('claude', 'a').apiKey).toBe('sk-acme');
  });

  test('an inline apiKey on update detaches the vault reference', () => {
    createProvider();
    profiles().upsert('claude', { name: 'a', baseUrl: 'https://x', providerId: 'acme' }, true);
    profiles().upsert('claude', { name: 'a', apiKey: 'sk-inline' }, false);
    const listed = profiles().list('claude')[0];
    expect(listed?.providerId).toBeUndefined();
    expect(profiles().decrypt('claude', 'a').apiKey).toBe('sk-inline');
  });

  test('creating a profile with an unknown provider or endpoint fails', () => {
    expect(() => profiles().upsert('claude', { name: 'x', providerId: 'ghost' }, true)).toThrow(
      /provider not found/,
    );
    createProvider();
    expect(() =>
      profiles().upsert(
        'claude',
        { name: 'x', providerId: 'acme', providerEndpoint: 'nope' },
        true,
      ),
    ).toThrow(/endpoint nope not found/);
  });

  test('backfill does not overwrite a vault-owned credential', () => {
    createProvider();
    profiles().upsert('claude', { name: 'a', baseUrl: 'https://x', providerId: 'acme' }, true);
    profiles().applyBackfill('claude', 'a', { apiKey: 'sk-from-live', baseUrl: 'https://live' });
    const decrypted = profiles().decrypt('claude', 'a');
    expect(decrypted.apiKey).toBe('sk-acme');
    expect(decrypted.baseUrl).toBe('https://live');
  });

  test('old profiles without a vault reference keep working', () => {
    profiles().upsert(
      'claude',
      { name: 'legacy', baseUrl: 'https://old.example/v1', apiKey: 'sk-legacy' },
      true,
    );
    const decrypted = profiles().decrypt('claude', 'legacy');
    expect(decrypted.apiKey).toBe('sk-legacy');
    expect(decrypted.baseUrl).toBe('https://old.example/v1');
  });
});
