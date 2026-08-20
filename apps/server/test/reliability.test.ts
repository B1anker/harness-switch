import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServices } from '../src/bootstrap';
import { IBackupService } from '../src/services/backup';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { ILiveWriteService, type PlannedWrite } from '../src/services/live-write';

let homeDir = '';
let services: ReturnType<typeof createServices>;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-rel-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.HSW_BACKUP_RETAIN;
  rmSync(homeDir, { recursive: true, force: true });
});

describe('live write', () => {
  test('rejects unparsable content before writing anything', () => {
    const live = services.get(ILiveWriteService);
    const target = join(homeDir, 'config.toml');
    writeFileSync(target, 'model = "keep"\n');

    expect(() =>
      live.apply('codex', 'broken', [{ path: target, format: 'toml', content: 'model = ' }]),
    ).toThrow(/not valid toml/);
    expect(readFileSync(target, 'utf8')).toBe('model = "keep"\n');
  });

  test('restores the original content when a later write fails', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    const first = join(homeDir, 'first.json');
    const second = join(homeDir, 'second.json');
    writeFileSync(first, '{"original":true}\n');

    const writes: PlannedWrite[] = [
      { path: first, format: 'json', content: '{"changed":true}\n' },
      { path: second, format: 'json', content: '{"changed":true}\n' },
    ];

    const realWrite = files.writeUserFile.bind(files);
    files.writeUserFile = (file, text) => {
      if (file === second) {
        throw new Error('disk full');
      }
      realWrite(file, text);
    };

    expect(() => live.apply('claude', 'demo', writes)).toThrow('disk full');
    files.writeUserFile = realWrite;

    expect(readFileSync(first, 'utf8')).toBe('{"original":true}\n');
  });

  test('rolls a file that did not exist back to being absent', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    const created = join(homeDir, 'created.json');
    const failing = join(homeDir, 'failing.json');

    const realWrite = files.writeUserFile.bind(files);
    files.writeUserFile = (file, text) => {
      if (file === failing) {
        throw new Error('disk full');
      }
      realWrite(file, text);
    };

    expect(() =>
      live.apply('claude', 'demo', [
        { path: created, format: 'json', content: '{}\n' },
        { path: failing, format: 'json', content: '{}\n' },
      ]),
    ).toThrow('disk full');
    files.writeUserFile = realWrite;

    // Truncating to an empty file would leave the harness with a config it cannot use.
    expect(files.exists(created)).toBe(false);
  });

  test('rolls a secret cache write back when its enclosing transaction fails', () => {
    const live = services.get(ILiveWriteService);
    const target = join(homeDir, '.codex', 'auth.json');
    const original = '{"tokens":{"access_token":"old-session"}}\n';
    mkdirSync(join(homeDir, '.codex'), { recursive: true, mode: 0o700 });
    writeFileSync(target, original, { mode: 0o644 });

    expect(() =>
      live.transaction(
        'codex',
        '导入登录缓存',
        [
          {
            path: target,
            format: 'json',
            content: '{"tokens":{"access_token":"new-session"}}\n',
            secret: true,
          },
        ],
        () => {
          throw new Error('profile store failed');
        },
      ),
    ).toThrow('profile store failed');

    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  test('keeps the permissions the user gave the file', () => {
    const live = services.get(ILiveWriteService);
    const target = join(homeDir, 'models.yml');
    writeFileSync(target, 'providers: {}\n');
    chmodSync(target, 0o644);

    live.apply('pi', 'demo', [{ path: target, format: 'yaml', content: 'providers:\n  a: {}\n' }]);

    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  test('new files holding an api key are not world readable', () => {
    const live = services.get(ILiveWriteService);
    const target = join(homeDir, 'fresh.json');

    live.apply('claude', 'demo', [{ path: target, format: 'json', content: '{}\n' }]);

    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});

describe('backups', () => {
  test('snapshots the previous content and restores it verbatim', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    const target = join(homeDir, 'config.toml');
    const original = '# a comment the round trip would lose\nmodel = "old"\n';
    writeFileSync(target, original);

    live.apply('codex', 'demo', [{ path: target, format: 'toml', content: 'model = "new"\n' }]);
    expect(readFileSync(target, 'utf8')).toBe('model = "new"\n');

    const entry = backups.list()[0];
    expect(entry?.files[0]?.path).toBe(target);
    backups.restore(entry?.id ?? '');

    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  test('detail compares the snapshot with the live file', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    const target = join(homeDir, 'config.toml');
    writeFileSync(target, 'model = "old"\n');

    live.apply('codex', 'demo', [{ path: target, format: 'toml', content: 'model = "new"\n' }]);

    const detail = backups.detail(backups.list()[0]?.id ?? '');
    expect(detail.files[0]?.content).toBe('model = "old"\n');
    expect(detail.files[0]?.currentContent).toBe('model = "new"\n');
  });

  test('list marks a snapshot as current only when it already matches the live files', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    const target = join(homeDir, 'config.toml');
    writeFileSync(target, 'model = "old"\n');

    live.apply('codex', 'demo', [{ path: target, format: 'toml', content: 'model = "new"\n' }]);
    expect(backups.list()[0]?.current).toBe(false);

    backups.restore(backups.list()[0]?.id ?? '');
    expect(backups.list()[0]?.current).toBe(true);
  });

  test('restoring deletes files that did not exist when the backup was taken', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    const target = join(homeDir, 'settings.json');

    live.apply('claude', 'demo', [{ path: target, format: 'json', content: '{"env":{}}\n' }]);
    expect(files.exists(target)).toBe(true);

    backups.restore(backups.list()[0]?.id ?? '');
    expect(files.exists(target)).toBe(false);
  });

  test('rotates old snapshots away instead of growing without bound', () => {
    process.env.HSW_BACKUP_RETAIN = '3';
    const rotating = createServices();
    rotating.get(IEnvironmentService).ensureDataDir();
    const backups = rotating.get(IBackupService);

    for (let index = 0; index < 6; index += 1) {
      backups.create('claude', `profile-${index}`, [
        { path: join(homeDir, `file-${index}.json`), content: '{}' },
      ]);
    }

    const entries = backups.list();
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.profile).toSorted()).toEqual([
      'profile-3',
      'profile-4',
      'profile-5',
    ]);
  });

  test('refuses ids that try to escape the backup directory', () => {
    const backups = services.get(IBackupService);
    expect(() => backups.restore('../../etc')).toThrow(/invalid backup id/);
  });
});
