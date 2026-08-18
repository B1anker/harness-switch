import { basename, join } from 'node:path';
import type { BackupDetail, BackupEntry } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

/** A file as it looked before a write; `content` is undefined when it did not exist. */
export type FileSnapshot = {
  path: string;
  content: string | undefined;
};

type StoredFile = {
  path: string;
  existed: boolean;
  /** File name inside the backup directory; absent when the file did not exist. */
  stored?: string;
};

type BackupManifest = {
  id: string;
  createdAt: string;
  harness: string;
  profile: string;
  files: StoredFile[];
};

export interface IBackupService {
  readonly _serviceBrand: undefined;
  create(harness: string, profile: string, snapshots: FileSnapshot[]): string | null;
  list(): BackupEntry[];
  detail(id: string): BackupDetail;
  restore(id: string): void;
}

export const IBackupService = createDecorator<IBackupService>('backupService');

const MANIFEST = 'manifest.json';

@inject(IEnvironmentService, IFileService)
export class BackupService implements IBackupService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
  ) {}

  create(harness: string, profile: string, snapshots: FileSnapshot[]): string | null {
    if (snapshots.length === 0) {
      return null;
    }
    const id = this.nextId(harness, profile);
    const dir = join(this.environment.backupsDir, id);
    this.files.ensureDir(dir);

    const stored: StoredFile[] = snapshots.map((snapshot, index) => {
      if (snapshot.content === undefined) {
        return { path: snapshot.path, existed: false };
      }
      const name = `${index}-${basename(snapshot.path)}`;
      this.files.writeSecure(join(dir, name), snapshot.content);
      return { path: snapshot.path, existed: true, stored: name };
    });

    const manifest: BackupManifest = {
      id,
      createdAt: new Date().toISOString(),
      harness,
      profile,
      files: stored,
    };
    this.files.writeJson(join(dir, MANIFEST), manifest);
    this.rotate();
    return id;
  }

  list(): BackupEntry[] {
    const liveCache = new Map<string, string | null>();
    const readLive = (path: string): string | null => {
      if (!liveCache.has(path)) {
        liveCache.set(path, this.files.readOptional(path) ?? null);
      }
      return liveCache.get(path) ?? null;
    };

    return this.readManifests()
      .map((manifest) => {
        const dir = join(this.environment.backupsDir, manifest.id);
        return {
          id: manifest.id,
          createdAt: manifest.createdAt,
          harness: manifest.harness,
          profile: manifest.profile,
          files: manifest.files.map((file) => ({ path: file.path, existed: file.existed })),
          current: this.matchesLive(dir, manifest.files, readLive),
        };
      })
      .toSorted((left, right) => right.id.localeCompare(left.id));
  }

  detail(id: string): BackupDetail {
    const { dir, manifest } = this.requireManifest(id);
    return {
      id: manifest.id,
      createdAt: manifest.createdAt,
      harness: manifest.harness,
      profile: manifest.profile,
      files: manifest.files.map((file) => ({
        path: file.path,
        existed: file.existed,
        content: this.storedContent(dir, file),
        currentContent: this.files.readOptional(file.path) ?? null,
      })),
    };
  }

  restore(id: string): void {
    const { dir, manifest } = this.requireManifest(id);
    for (const file of manifest.files) {
      if (!file.existed || !file.stored) {
        this.files.remove(file.path);
        continue;
      }
      const content = this.files.readOptional(join(dir, file.stored));
      if (content === undefined) {
        throw new HttpError(500, `backup payload missing for ${file.path}`);
      }
      this.files.writeUserFile(file.path, content);
    }
  }

  private requireManifest(id: string): { dir: string; manifest: BackupManifest } {
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new HttpError(400, 'invalid backup id');
    }
    const dir = join(this.environment.backupsDir, id);
    const manifest = this.files.readJson<BackupManifest | null>(join(dir, MANIFEST), null);
    if (!manifest) {
      throw new HttpError(404, 'backup not found');
    }
    return { dir, manifest };
  }

  private matchesLive(
    dir: string,
    files: StoredFile[],
    readLive: (path: string) => string | null,
  ): boolean {
    return files.every((file) => this.storedContent(dir, file) === readLive(file.path));
  }

  private storedContent(dir: string, file: StoredFile): string | null {
    if (!file.existed || !file.stored) {
      return null;
    }
    const content = this.files.readOptional(join(dir, file.stored));
    if (content === undefined) {
      throw new HttpError(500, `backup payload missing for ${file.path}`);
    }
    return content;
  }

  private readManifests(): BackupManifest[] {
    return this.files
      .listDirectories(this.environment.backupsDir)
      .map((name) =>
        this.files.readJson<BackupManifest | null>(
          join(this.environment.backupsDir, name, MANIFEST),
          null,
        ),
      )
      .filter((manifest): manifest is BackupManifest => manifest !== null);
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

  private rotate(): void {
    const names = this.files.listDirectories(this.environment.backupsDir).toSorted();
    const excess = names.length - this.environment.backupRetainCount;
    for (let index = 0; index < excess; index += 1) {
      this.files.remove(join(this.environment.backupsDir, names[index]!));
    }
  }
}
