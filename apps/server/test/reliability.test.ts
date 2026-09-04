import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessId } from '@seaveyon/harness-switch-shared';
import type { InstantiationService } from '../src/di';
import { IBackupService } from '../src/services/backup';
import { IFileService } from '../src/services/files';
import { IJournalService } from '../src/services/journal';
import {
  ILiveWriteService,
  type OperationPlan,
  type PlannedWrite,
} from '../src/services/live-write';
import { createSandbox, createTestServices, type Sandbox } from './support';

let sandbox: Sandbox;
let services: InstantiationService;

/** Live writes only ever target a path an adapter owns, so the tests use real ones. */
let claudeSettings = '';
let codexConfig = '';
let codexAuth = '';
let dshSettings = '';
let piModels = '';
let piSettings = '';

beforeEach(() => {
  sandbox = createSandbox('hsw-rel');
  services = createTestServices();
  claudeSettings = sandbox.home('.claude', 'settings.json');
  codexConfig = sandbox.home('.codex', 'config.toml');
  codexAuth = sandbox.home('.codex', 'auth.json');
  dshSettings = sandbox.home('.dsh', 'settings.yaml');
  piModels = sandbox.home('.pi', 'agent', 'models.json');
  piSettings = sandbox.home('.pi', 'agent', 'settings.json');
});

afterEach(() => {
  sandbox.dispose();
});

function seed(file: string, content: string, mode = 0o600): void {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode });
}

/** Most of these tests only care about the writes, not which operation produced them. */
function plan(harness: HarnessId, profile: string, writes: PlannedWrite[]): OperationPlan {
  return { kind: 'activate', harness, profile, writes };
}

/** The single backup directory a test just produced, so its manifest can be tampered with. */
function onlyBackupDir(): string {
  const names = readdirSync(sandbox.data('backups'));
  expect(names).toHaveLength(1);
  return sandbox.data('backups', names[0]!);
}

describe('live write', () => {
  test('journals metadata-only transactions so they remain undoable after a crash', () => {
    const live = services.get(ILiveWriteService);
    const journal = services.get(IJournalService);
    const profiles = sandbox.data('profiles.json');
    seed(profiles, '{"before":true}\n');

    live.transaction(
      {
        kind: 'import',
        harness: 'codex',
        profile: 'metadata-only import',
        writes: [],
        metadata: ['profiles'],
      },
      () => seed(profiles, '{"after":true}\n'),
    );

    const receipt = journal.list()[0];
    expect(receipt?.state).toBe('committed');
    expect(receipt?.backupId).toBeNull();
    expect(receipt?.metadata).toEqual(['profiles']);

    journal.undo(receipt?.id ?? '');
    expect(readFileSync(profiles, 'utf8')).toBe('{"before":true}\n');
  });

  test('rejects unparsable content before writing anything', () => {
    const live = services.get(ILiveWriteService);
    seed(codexConfig, 'model = "keep"\n');

    expect(() =>
      live.apply(
        plan('codex', 'broken', [
          { key: 'config', path: codexConfig, format: 'toml', content: 'model = ' },
        ]),
      ),
    ).toThrow(/not valid toml/);
    expect(readFileSync(codexConfig, 'utf8')).toBe('model = "keep"\n');
  });

  test('restores the original content when a later write fails', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    seed(piModels, '{"original":true}\n');

    const writes: PlannedWrite[] = [
      { key: 'models', path: piModels, format: 'json', content: '{"changed":true}\n' },
      { key: 'settings', path: piSettings, format: 'json', content: '{"changed":true}\n' },
    ];

    const realWrite = files.writeUserFile.bind(files);
    files.writeUserFile = (file, text) => {
      if (file === piSettings) {
        throw new Error('disk full');
      }
      realWrite(file, text);
    };

    expect(() => live.apply(plan('pi', 'demo', writes))).toThrow('disk full');
    files.writeUserFile = realWrite;

    expect(readFileSync(piModels, 'utf8')).toBe('{"original":true}\n');
  });

  test('rolls a file that did not exist back to being absent', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);

    const realWrite = files.writeUserFile.bind(files);
    files.writeUserFile = (file, text) => {
      if (file === piSettings) {
        throw new Error('disk full');
      }
      realWrite(file, text);
    };

    expect(() =>
      live.apply(
        plan('pi', 'demo', [
          { key: 'models', path: piModels, format: 'json', content: '{}\n' },
          { key: 'settings', path: piSettings, format: 'json', content: '{}\n' },
        ]),
      ),
    ).toThrow('disk full');
    files.writeUserFile = realWrite;

    // Truncating to an empty file would leave the harness with a config it cannot use.
    expect(files.exists(piModels)).toBe(false);
  });

  test('rolls a secret cache write back when its enclosing transaction fails', () => {
    const live = services.get(ILiveWriteService);
    const original = '{"tokens":{"access_token":"old-session"}}\n';
    seed(codexAuth, original, 0o644);

    expect(() =>
      live.transaction(
        {
          kind: 'import',
          harness: 'codex',
          profile: '导入登录缓存',
          writes: [
            {
              key: 'auth',
              path: codexAuth,
              format: 'json',
              content: '{"tokens":{"access_token":"new-session"}}\n',
              secret: true,
            },
          ],
        },
        () => {
          throw new Error('profile store failed');
        },
      ),
    ).toThrow('profile store failed');

    expect(readFileSync(codexAuth, 'utf8')).toBe(original);
    expect(statSync(codexAuth).mode & 0o777).toBe(0o600);
  });

  test('keeps the permissions the user gave the file', () => {
    const live = services.get(ILiveWriteService);
    seed(dshSettings, 'providers: {}\n', 0o644);

    live.apply(
      plan('dsh', 'demo', [
        { key: 'settings', path: dshSettings, format: 'yaml', content: 'providers:\n  a: {}\n' },
      ]),
    );

    expect(statSync(dshSettings).mode & 0o777).toBe(0o644);
  });

  test('new files holding an api key are not world readable', () => {
    const live = services.get(ILiveWriteService);

    live.apply(
      plan('claude', 'demo', [
        { key: 'settings', path: claudeSettings, format: 'json', content: '{}\n' },
      ]),
    );

    expect(statSync(claudeSettings).mode & 0o777).toBe(0o600);
  });

  test('refuses a target whose directory is a symlink out of the home', () => {
    const live = services.get(ILiveWriteService);
    const outside = mkdtempSync(join(tmpdir(), 'hsw-outside-'));
    symlinkSync(outside, sandbox.home('.claude'));

    try {
      expect(() =>
        live.apply(
          plan('claude', 'demo', [
            { key: 'settings', path: claudeSettings, format: 'json', content: '{"leaked":true}\n' },
          ]),
        ),
      ).toThrow(/可管理目录之外/);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('backups', () => {
  test('snapshots the previous content and restores it verbatim', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    const original = '# a comment the round trip would lose\nmodel = "old"\n';
    seed(codexConfig, original);

    live.apply(
      plan('codex', 'demo', [
        { key: 'config', path: codexConfig, format: 'toml', content: 'model = "new"\n' },
      ]),
    );
    expect(readFileSync(codexConfig, 'utf8')).toBe('model = "new"\n');

    const entry = backups.list()[0];
    expect(entry?.files[0]?.path).toBe(codexConfig);
    backups.restore(entry?.id ?? '');

    expect(readFileSync(codexConfig, 'utf8')).toBe(original);
  });

  test('detail compares the snapshot with the live file', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    seed(codexConfig, 'model = "old"\n');

    live.apply(
      plan('codex', 'demo', [
        { key: 'config', path: codexConfig, format: 'toml', content: 'model = "new"\n' },
      ]),
    );

    const detail = backups.detail(backups.list()[0]?.id ?? '');
    expect(detail.files[0]?.content).toBe('model = "old"\n');
    expect(detail.files[0]?.currentContent).toBe('model = "new"\n');
  });

  test('list marks a snapshot as current only when it already matches the live files', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    seed(codexConfig, 'model = "old"\n');

    live.apply(
      plan('codex', 'demo', [
        { key: 'config', path: codexConfig, format: 'toml', content: 'model = "new"\n' },
      ]),
    );
    expect(backups.list()[0]?.current).toBe(false);

    backups.restore(backups.list()[0]?.id ?? '');
    // The restore takes its own snapshot first, so the restored one is no longer newest.
    expect(backups.list().find((entry) => entry.profile === 'demo')?.current).toBe(true);
  });

  test('restoring deletes files that did not exist when the backup was taken', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);

    live.apply(
      plan('claude', 'demo', [
        { key: 'settings', path: claudeSettings, format: 'json', content: '{"env":{}}\n' },
      ]),
    );
    expect(files.exists(claudeSettings)).toBe(true);

    backups.restore(backups.list()[0]?.id ?? '');
    expect(files.exists(claudeSettings)).toBe(false);
  });

  test('rotates old snapshots away instead of growing without bound', () => {
    sandbox.setEnv('HSW_BACKUP_RETAIN', '3');
    // A graph built after the limit is set, since the retain count is read at construction.
    const backups = createTestServices().get(IBackupService);

    for (let index = 0; index < 6; index += 1) {
      backups.create('claude', `profile-${index}`, [
        { key: 'settings', path: claudeSettings, content: `{"n":${index}}` },
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

  test('refuses to back up a path the harness does not own', () => {
    const backups = services.get(IBackupService);
    expect(() =>
      backups.create('claude', 'demo', [
        { key: 'settings', path: sandbox.home('elsewhere.json'), content: '{}' },
      ]),
    ).toThrow(/not a claude target/);
  });
});

describe('tampered backups', () => {
  function backupOf(path: string, key: string, harness: 'claude' | 'codex'): string {
    const live = services.get(ILiveWriteService);
    seed(path, '{"original":true}\n');
    live.apply(plan(harness, 'demo', [{ key, path, format: 'json', content: '{"new":true}\n' }]));
    return onlyBackupDir();
  }

  test('ignores the path a manifest asks for and rewrites the adapter target', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');
    const victim = sandbox.home('victim.json');
    seed(victim, 'untouched\n');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files[0].path = victim;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    backups.restore(backups.list()[0]?.id ?? '');

    expect(readFileSync(victim, 'utf8')).toBe('untouched\n');
    expect(readFileSync(claudeSettings, 'utf8')).toBe('{"original":true}\n');
  });

  test('still restores a manifest written before target keys were recorded', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files[0] = {
      path: claudeSettings,
      existed: true,
      stored: manifest.files[0].stored,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    backups.restore(backups.list()[0]?.id ?? '');
    expect(readFileSync(claudeSettings, 'utf8')).toBe('{"original":true}\n');
  });

  test('refuses a manifest whose target key the harness does not own', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files[0].key = 'credentials';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    const id = readdirSync(sandbox.data('backups'))[0]!;
    expect(() => backups.restore(id)).toThrow(/does not own/);
    // An unrestorable backup is dropped from the listing rather than breaking it.
    expect(backups.list()).toHaveLength(0);
  });

  test('refuses a manifest naming an unknown harness', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.harness = 'evil';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    const id = readdirSync(sandbox.data('backups'))[0]!;
    expect(() => backups.restore(id)).toThrow(/backup not found/);
  });

  test('refuses a payload name that points outside the backup directory', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files[0].stored = '../../../../etc/hostname';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    const id = readdirSync(sandbox.data('backups'))[0]!;
    expect(() => backups.detail(id)).toThrow(/invalid backup payload name/);
  });

  test('refuses a payload that was swapped for a symlink', () => {
    const backups = services.get(IBackupService);
    const dir = backupOf(claudeSettings, 'settings', 'claude');
    const secret = sandbox.home('secret.txt');
    seed(secret, 'root-only\n');

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const payload = join(dir, manifest.files[0].stored);
    rmSync(payload);
    symlinkSync(secret, payload);

    const id = readdirSync(sandbox.data('backups'))[0]!;
    expect(() => backups.detail(id)).toThrow(/不是普通文件/);
  });
});

describe('restore rollback', () => {
  test('puts every already-restored file back when a later one fails', () => {
    const files = services.get(IFileService);
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    seed(piModels, '{"models":"old"}\n');
    seed(piSettings, '{"settings":"old"}\n');

    live.apply(
      plan('pi', 'demo', [
        { key: 'models', path: piModels, format: 'json', content: '{"models":"new"}\n' },
        { key: 'settings', path: piSettings, format: 'json', content: '{"settings":"new"}\n' },
      ]),
    );

    const id = backups.list()[0]?.id ?? '';
    const realWrite = files.writeUserFile.bind(files);
    files.writeUserFile = (file, text) => {
      if (file === piSettings) {
        throw new Error('disk full');
      }
      realWrite(file, text);
    };

    expect(() => backups.restore(id)).toThrow('disk full');
    files.writeUserFile = realWrite;

    // A half-applied restore would leave the two files describing different providers.
    expect(readFileSync(piModels, 'utf8')).toBe('{"models":"new"}\n');
    expect(readFileSync(piSettings, 'utf8')).toBe('{"settings":"new"}\n');
  });

  test('takes an undo point before overwriting the live files', () => {
    const live = services.get(ILiveWriteService);
    const backups = services.get(IBackupService);
    seed(codexConfig, 'model = "old"\n');

    live.apply(
      plan('codex', 'demo', [
        { key: 'config', path: codexConfig, format: 'toml', content: 'model = "new"\n' },
      ]),
    );
    backups.restore(backups.list()[0]?.id ?? '');

    const undo = backups.list().find((entry) => entry.profile === '恢复前-demo');
    expect(undo).toBeDefined();
    backups.restore(undo?.id ?? '');
    expect(readFileSync(codexConfig, 'utf8')).toBe('model = "new"\n');
  });
});
