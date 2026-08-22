import { basename, join, resolve } from 'node:path';
import {
  type BackupDetail,
  type BackupEntry,
  type HarnessId,
  isHarnessId,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { type AdapterTarget, IAdapterRegistry } from './adapters';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';

/** A file as it looked before a write; `content` is undefined when it did not exist. */
export type FileSnapshot = {
  /** Adapter target key, which is what the manifest records. */
  key: string;
  path: string;
  content: string | undefined;
};

type StoredFile = {
  key: string;
  existed: boolean;
  /** File name inside the backup directory; absent when the file did not exist. */
  stored?: string;
  /**
   * Only written by versions that recorded absolute paths. It is matched back to a
   * target to keep those backups restorable and is never used as a destination.
   */
  path?: string;
};

type BackupManifest = {
  createdAt: string;
  harness: HarnessId;
  profile: string;
  files: StoredFile[];
};

type LoadedBackup = {
  /** The directory name, which is the only trustworthy id: the manifest is user-writable. */
  id: string;
  dir: string;
  manifest: BackupManifest;
};

/** One file to put back, with its destination resolved from the adapter. */
type RestoreStep = {
  key: string;
  path: string;
  /** Snapshot content, or null when the file did not exist and has to be deleted. */
  content: string | null;
};

export interface IBackupService {
  readonly _serviceBrand: undefined;
  create(harness: HarnessId, profile: string, snapshots: FileSnapshot[]): string | null;
  list(): BackupEntry[];
  detail(id: string): BackupDetail;
  restore(id: string): void;
  /** Whether a snapshot is still on disk, i.e. has not been rotated away yet. */
  exists(id: string): boolean;
}

export const IBackupService = createDecorator<IBackupService>('backupService');

const MANIFEST = 'manifest.json';

/**
 * Backup directories live in the managed user's own home, so on a root-run service the
 * account being managed can rewrite its own manifests. Nothing read back out of one is
 * therefore treated as a destination: paths are re-derived from the harness adapter, and
 * payload names have to stay inside the backup directory.
 */
@inject(IEnvironmentService, IFileService, IAdapterRegistry, ILogService)
export class BackupService implements IBackupService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly adapters: IAdapterRegistry,
    private readonly log: ILogService,
  ) {}

  create(harness: HarnessId, profile: string, snapshots: FileSnapshot[]): string | null {
    return this.store(harness, profile, snapshots);
  }

  list(): BackupEntry[] {
    const liveCache = new Map<string, string | null>();
    const readLive = (path: string): string | null => {
      if (!liveCache.has(path)) {
        liveCache.set(path, this.files.readOptional(path) ?? null);
      }
      return liveCache.get(path) ?? null;
    };

    const entries: BackupEntry[] = [];
    for (const backup of this.load()) {
      let steps: RestoreStep[];
      try {
        steps = this.plan(backup);
      } catch (error) {
        // A backup nobody can restore is not worth offering. Skipping keeps the rest of
        // the list usable, and the log is what tells an operator a manifest was touched.
        this.log.error(`ignoring unusable backup ${backup.id}`, error);
        continue;
      }
      entries.push({
        id: backup.id,
        createdAt: backup.manifest.createdAt,
        harness: backup.manifest.harness,
        profile: backup.manifest.profile,
        files: steps.map((step) => ({ path: step.path, existed: step.content !== null })),
        current: steps.every((step) => step.content === readLive(step.path)),
      });
    }
    return entries.toSorted((left, right) => right.id.localeCompare(left.id));
  }

  exists(id: string): boolean {
    try {
      this.require(id);
      return true;
    } catch {
      return false;
    }
  }

  detail(id: string): BackupDetail {
    const backup = this.require(id);
    return {
      id: backup.id,
      createdAt: backup.manifest.createdAt,
      harness: backup.manifest.harness,
      profile: backup.manifest.profile,
      files: this.plan(backup).map((step) => ({
        path: step.path,
        existed: step.content !== null,
        content: step.content,
        currentContent: this.files.readOptional(step.path) ?? null,
      })),
    };
  }

  restore(id: string): void {
    const backup = this.require(id);
    // Every payload is read before the first write, so a missing or unreadable one
    // aborts the restore instead of leaving it half applied.
    const steps = this.plan(backup);
    const snapshots: FileSnapshot[] = steps.map((step) => ({
      key: step.key,
      path: step.path,
      content: this.files.readOptional(step.path),
    }));
    // A restore overwrites live files just like an activation does, so it gets its own
    // undo point first. `keep` stops rotation from discarding the backup being restored.
    this.store(backup.manifest.harness, `恢复前-${backup.manifest.profile}`, snapshots, backup.id);

    const applied: FileSnapshot[] = [];
    try {
      for (const [index, step] of steps.entries()) {
        if (step.content === null) {
          this.files.remove(step.path);
        } else {
          this.files.writeUserFile(step.path, step.content);
        }
        applied.push(snapshots[index]!);
      }
    } catch (error) {
      this.rollback(applied);
      throw error;
    }
  }

  private rollback(applied: FileSnapshot[]): void {
    for (const snapshot of applied.toReversed()) {
      try {
        if (snapshot.content === undefined) {
          this.files.remove(snapshot.path);
        } else {
          this.files.writeUserFile(snapshot.path, snapshot.content);
        }
      } catch (error) {
        this.log.error(`restore rollback failed for ${snapshot.path}`, error);
      }
    }
  }

  /** `keep` protects a backup that is being restored from being rotated away mid-restore. */
  private store(
    harness: HarnessId,
    profile: string,
    snapshots: FileSnapshot[],
    keep?: string,
  ): string | null {
    if (snapshots.length === 0) {
      return null;
    }
    const targets = this.adapters.get(harness).targets();
    const id = this.nextId(harness, profile);
    const dir = join(this.environment.backupsDir, id);
    this.files.ensureDir(dir);

    const stored: StoredFile[] = snapshots.map((snapshot, index) => {
      const target = targets.find((candidate) => candidate.key === snapshot.key);
      if (!target || resolve(target.path) !== resolve(snapshot.path)) {
        throw new HttpError(500, `refusing to back up ${snapshot.path}: not a ${harness} target`);
      }
      if (snapshot.content === undefined) {
        return { key: target.key, existed: false };
      }
      const name = `${index}-${basename(target.path)}`;
      this.files.writeSecure(join(dir, name), snapshot.content);
      return { key: target.key, existed: true, stored: name };
    });

    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      harness,
      profile,
      files: stored,
    };
    this.files.writeJson(join(dir, MANIFEST), manifest);
    this.rotate(keep);
    return id;
  }

  private require(id: string): LoadedBackup {
    if (id !== basename(id) || id === '.' || id === '..' || id.includes('\\')) {
      throw new HttpError(400, 'invalid backup id');
    }
    const dir = join(this.environment.backupsDir, id);
    const manifest = this.parse(this.files.readJson<unknown>(join(dir, MANIFEST), null));
    if (!manifest) {
      throw new HttpError(404, 'backup not found');
    }
    return { id, dir, manifest };
  }

  private load(): LoadedBackup[] {
    const backups: LoadedBackup[] = [];
    for (const id of this.files.listDirectories(this.environment.backupsDir)) {
      const dir = join(this.environment.backupsDir, id);
      const manifest = this.parse(this.files.readJson<unknown>(join(dir, MANIFEST), null));
      if (!manifest) {
        this.log.error(`ignoring unreadable backup manifest in ${id}`);
        continue;
      }
      backups.push({ id, dir, manifest });
    }
    return backups;
  }

  private plan(backup: LoadedBackup): RestoreStep[] {
    const targets = this.adapters.get(backup.manifest.harness).targets();
    return backup.manifest.files.map((file) => {
      const target = this.locate(targets, backup.manifest.harness, file);
      // The adapter derives the path from the selected user's home, but that home can
      // still hold a symlink pointing out of it.
      this.files.assertManaged(target.path);
      return { key: target.key, path: target.path, content: this.storedContent(backup.dir, file) };
    });
  }

  private locate(targets: AdapterTarget[], harness: HarnessId, file: StoredFile): AdapterTarget {
    const target = file.key
      ? targets.find((candidate) => candidate.key === file.key)
      : targets.find((candidate) => file.path && resolve(candidate.path) === resolve(file.path));
    if (!target) {
      throw new HttpError(400, `backup references a file ${harness} does not own`);
    }
    return target;
  }

  private storedContent(dir: string, file: StoredFile): string | null {
    if (!file.existed) {
      return null;
    }
    if (!file.stored) {
      throw new HttpError(500, `backup payload missing for ${file.key || file.path}`);
    }
    const content = this.files.readRegularOptional(this.payloadPath(dir, file.stored));
    if (content === undefined) {
      throw new HttpError(500, `backup payload missing for ${file.key || file.path}`);
    }
    return content;
  }

  /** Keeps a payload name a plain entry of the backup directory rather than a path. */
  private payloadPath(dir: string, stored: string): string {
    if (stored !== basename(stored) || stored === '.' || stored === '..') {
      throw new HttpError(400, 'invalid backup payload name');
    }
    return join(dir, stored);
  }

  private parse(value: unknown): BackupManifest | null {
    if (!isRecord(value)) {
      return null;
    }
    const { createdAt, harness, profile, files } = value;
    if (typeof createdAt !== 'string' || typeof harness !== 'string' || !isHarnessId(harness)) {
      return null;
    }
    if (typeof profile !== 'string' || !Array.isArray(files)) {
      return null;
    }
    const parsed: StoredFile[] = [];
    for (const file of files) {
      if (!isRecord(file) || typeof file.existed !== 'boolean') {
        return null;
      }
      const key = typeof file.key === 'string' ? file.key : '';
      const path = typeof file.path === 'string' ? file.path : undefined;
      const stored = typeof file.stored === 'string' ? file.stored : undefined;
      if (!key && !path) {
        return null;
      }
      parsed.push({ key, existed: file.existed, stored, path });
    }
    return { createdAt, harness, profile, files: parsed };
  }

  /** Ids start with a sortable timestamp, so lexicographic order is chronological. */
  private nextId(harness: string, profile: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = `${harness}-${profile}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
    const base = `${stamp}-${slug}`;
    let candidate = base;
    let suffix = 1;
    while (this.files.exists(join(this.environment.backupsDir, candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private rotate(keep?: string): void {
    const names = this.files.listDirectories(this.environment.backupsDir).toSorted();
    let excess = names.length - this.environment.backupRetainCount;
    for (const name of names) {
      if (excess <= 0) {
        break;
      }
      if (name === keep) {
        continue;
      }
      this.files.remove(join(this.environment.backupsDir, name));
      excess -= 1;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
