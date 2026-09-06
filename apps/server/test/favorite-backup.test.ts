import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import {
  ERROR_CODES,
  type FavoriteBackupEntry,
  type FavoriteBackupPreview,
} from '@seaveyon/harness-switch-shared';
import { IAdapterRegistry } from '../src/services/adapters';
import { IEnvironmentService } from '../src/services/environment';
import { IFavoriteBackupService } from '../src/services/favorite-backup';
import { IFileService } from '../src/services/files';
import { createSandbox, createTestApp, type Sandbox } from './support';
import { expectResponseError } from './support/http-error';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-favorite-backup');
});
afterEach(() => sandbox.dispose());

test('manual restore puts metadata and native files back, deletes newly created files and can itself be undone', async () => {
  const app = await createTestApp();
  const files = app.services.get(IFileService);
  const env = app.services.get(IEnvironmentService);
  const targets = app.services
    .get(IAdapterRegistry)
    .all()
    .flatMap((adapter) => adapter.targets());
  files.writeSecure(targets[0]!.path, '{"test":"secret-before"}');
  const { data: saved } = await app.postJson<{ data: FavoriteBackupEntry }>(
    '/api/model-favorites/backups',
  );
  await app.postJson('/api/model-favorites', { name: 'new favorite' });
  files.writeSecure(targets[0]!.path, '{"test":"secret-after"}');
  files.writeSecure(targets[1]!.path, '{}');
  files.writeJson(env.files.vault, { providers: [] });
  const response = await app.post(`/api/model-favorites/backups/${saved.id}/restore`);
  expect(response.status).toBe(200);
  expect(files.readOptional(env.files.favorites)).toBeUndefined();
  expect(files.readOptional(env.files.vault)).toBeUndefined();
  expect(files.readText(targets[0]!.path)).toContain('secret-before');
  expect(files.readOptional(targets[1]!.path)).toBeUndefined();
  const { data: history } = await app.json<{ data: FavoriteBackupEntry[] }>(
    '/api/model-favorites/backups',
  );
  const undo = history.find((entry) => entry.reason === 'restore')!;
  await app.postJson(`/api/model-favorites/backups/${undo.id}/restore`);
  expect(files.readText(env.files.favorites)).toContain('new favorite');
  expect(files.readText(targets[0]!.path)).toContain('secret-after');
  expect(files.readText(targets[1]!.path)).toBe('{}');
  expect(JSON.stringify(history)).not.toContain('secret-');
  expect(files.readText(join(env.dataDir, 'favorite-backups', 'history.json'))).not.toContain(
    'secret-',
  );
});

test('automatic checkpoints precede changes and preserve a manual checkpoint through rotation', async () => {
  const app = await createTestApp();
  const backups = app.services.get(IFavoriteBackupService);
  const manual = backups.create();
  for (let i = 0; i < 23; i++) {
    await app.postJson('/api/model-favorites', { name: `favorite-${i}` });
  }
  expect(backups.list()).toHaveLength(21);
  expect(backups.list().some((entry) => entry.id === manual.id)).toBe(true);
  backups.restore(backups.list().find((entry) => entry.reason === 'change')!.id);
  const { data } = await app.json<{ data: unknown[] }>('/api/model-favorites');
  expect(data).toHaveLength(22);
});

test('failed restore rolls back and an interrupted rollback recovers before a new process serves configuration', async () => {
  const app = await createTestApp();
  const files = app.services.get(IFileService);
  const env = app.services.get(IEnvironmentService);
  await app.postJson('/api/model-favorites', { name: 'before' });
  const saved = app.services.get(IFavoriteBackupService).create();
  await app.postJson('/api/model-favorites', { name: 'keep-current' });
  const current = files.readText(env.files.favorites);
  const original = files.writeUserSecretFile.bind(files);
  const failure = spyOn(files, 'writeUserSecretFile').mockImplementation((path, content) => {
    if (path === env.files.profiles) {
      throw new Error('injected disk failure');
    }
    original(path, content);
  });
  // Ensure the second destination is a write, so the first can already have changed.
  files.writeJson(env.files.profiles, {});
  const withProfiles = app.services.get(IFavoriteBackupService).create('change');
  files.writeJson(env.files.favorites, { schemaVersion: 1, favorites: [] });
  await expectResponseError(
    await app.post(`/api/model-favorites/backups/${withProfiles.id}/restore`),
    ERROR_CODES.favoriteBackupRecoveryFailed,
  );
  expect(files.exists(join(env.dataDir, 'favorite-backups', 'pending.json'))).toBe(true);
  failure.mockRestore();
  const restarted = await createTestApp();
  await restarted.json('/api/model-favorites');
  expect(files.readText(env.files.favorites)).toContain('"favorites": []');
  expect(files.exists(join(env.dataDir, 'favorite-backups', 'pending.json'))).toBe(false);
  // The original checkpoint remains usable after recovery.
  await restarted.postJson(`/api/model-favorites/backups/${saved.id}/restore`);
  expect(files.readText(env.files.favorites)).not.toContain('keep-current');
  expect(current).toContain('keep-current');
});

test('tampered encrypted checkpoint is rejected before current files change', async () => {
  const app = await createTestApp();
  const files = app.services.get(IFileService);
  const env = app.services.get(IEnvironmentService);
  const saved = app.services.get(IFavoriteBackupService).create();
  const path = join(env.dataDir, 'favorite-backups', 'history.json');
  const raw = JSON.parse(files.readText(path));
  raw.entries[0].snapshot.data = 'tampered';
  files.writeJson(path, raw);
  await expectResponseError(
    await app.post(`/api/model-favorites/backups/${saved.id}/restore`),
    ERROR_CODES.favoriteBackupInvalid,
  );
  expect(files.readOptional(env.files.favorites)).toBeUndefined();
});

test('restore preview identifies file effects without contents and rejects stale confirmation', async () => {
  const app = await createTestApp();
  const files = app.services.get(IFileService);
  const env = app.services.get(IEnvironmentService);
  const target = app.services.get(IAdapterRegistry).get('claude').targets()[0]!;
  files.writeSecure(target.path, '{"apiKey":"fake-before"}');
  const saved = app.services.get(IFavoriteBackupService).create();
  files.writeSecure(target.path, '{"apiKey":"fake-after"}');
  await app.postJson('/api/model-favorites', { name: 'new-favorite' });
  const { data: preview } = await app.json<{ data: FavoriteBackupPreview }>(
    `/api/model-favorites/backups/${saved.id}/preview`,
  );
  expect(preview.files.find((file) => file.path === target.path)?.action).toBe('replace');
  expect(preview.files.find((file) => file.key === 'store/favorites')?.action).toBe('delete');
  expect(preview.files.some((file) => file.action === 'unchanged')).toBe(true);
  expect(JSON.stringify(preview)).not.toContain('fake-');
  expect(files.readText(target.path)).toContain('fake-after');
  files.writeSecure(target.path, '{"apiKey":"fake-newer"}');
  await expectResponseError(
    await app.post(`/api/model-favorites/backups/${saved.id}/restore`, {
      fingerprint: preview.fingerprint,
    }),
    ERROR_CODES.favoriteBackupStale,
  );
  expect(files.readText(target.path)).toContain('fake-newer');
  expect(files.readText(env.files.favorites)).toContain('new-favorite');
  const fresh = app.services.get(IFavoriteBackupService).preview(saved.id);
  await app.postJson(`/api/model-favorites/backups/${saved.id}/restore`, {
    fingerprint: fresh.fingerprint,
  });
  expect(files.readText(target.path)).toContain('fake-before');
  expect(files.readOptional(env.files.favorites)).toBeUndefined();
});

test('backup operation context is encrypted and older backups still list', async () => {
  const app = await createTestApp();
  const backups = app.services.get(IFavoriteBackupService);
  const old = backups.create();
  await app.postJson('/api/model-favorites', { name: 'descriptive-favorite' });
  const entry = backups.list().find((item) => item.reason === 'change')!;
  expect(entry.context).toEqual({ action: 'create', name: 'descriptive-favorite' });
  expect(backups.list().find((item) => item.id === old.id)?.context).toBeUndefined();
  const raw = app.services
    .get(IFileService)
    .readText(
      join(app.services.get(IEnvironmentService).dataDir, 'favorite-backups', 'history.json'),
    );
  expect(raw).not.toContain('descriptive-favorite');
  expect(backups.preview(old.id).files.some((file) => file.action === 'delete')).toBe(true);
});
