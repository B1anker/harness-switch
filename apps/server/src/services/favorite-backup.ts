import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ERROR_CODES, type FavoriteBackupEntry } from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IAdapterRegistry } from './adapters';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

const sealed = z.object({ iv: z.string(), tag: z.string(), data: z.string() });
const entrySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reason: z.enum(['manual', 'change', 'apply', 'restore']),
  snapshot: sealed,
});
const historySchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(21) });
const snapshotSchema = z.object({
  version: z.literal(1),
  user: z.string(),
  files: z.array(z.object({ key: z.string(), path: z.string(), content: z.string().nullable() })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

export interface IFavoriteBackupService {
  readonly _serviceBrand: undefined;
  list(): FavoriteBackupEntry[];
  create(reason?: FavoriteBackupEntry['reason']): FavoriteBackupEntry;
  restore(id: string): void;
  recover(): void;
  protect<T>(reason: FavoriteBackupEntry['reason'], operation: () => T): T;
}
export const IFavoriteBackupService =
  createDecorator<IFavoriteBackupService>('favoriteBackupService');

@inject(IEnvironmentService, IFileService, ICryptoService, IAdapterRegistry)
export class FavoriteBackupService implements IFavoriteBackupService {
  declare readonly _serviceBrand: undefined;
  private depth = 0;
  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly adapters: IAdapterRegistry,
  ) {}

  list(): FavoriteBackupEntry[] {
    return this.history().entries.map(({ snapshot: _snapshot, ...entry }) => entry);
  }

  create(reason: FavoriteBackupEntry['reason'] = 'manual'): FavoriteBackupEntry {
    const history = this.history();
    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      reason,
      snapshot: this.crypto.encrypt(JSON.stringify(this.capture())),
    };
    // Keep one explicit checkpoint as well as twenty rolling automatic checkpoints.
    const prior =
      reason === 'manual'
        ? history.entries.filter((item) => item.reason !== 'manual')
        : history.entries;
    const entries = [entry, ...prior];
    const manual = entries.filter((item) => item.reason === 'manual').slice(0, 1);
    const automatic = entries.filter((item) => item.reason !== 'manual').slice(0, 20);
    this.files.writeJson(this.path('history.json'), {
      version: 1,
      entries: [...manual, ...automatic].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
    const { snapshot: _snapshot, ...summary } = entry;
    return summary;
  }

  protect<T>(reason: FavoriteBackupEntry['reason'], operation: () => T): T {
    if (this.depth === 0) {
      this.create(reason);
    }
    this.depth++;
    try {
      return operation();
    } finally {
      this.depth--;
    }
  }

  restore(id: string): void {
    const entry = this.history().entries.find((item) => item.id === id);
    if (!entry) {
      throw this.invalid();
    }
    const target = this.decode(entry.snapshot);
    const before = this.capture();
    this.create('restore');
    // A durable rollback point survives a process exit during a multi-file restore.
    this.files.writeJson(this.path('pending.json'), this.crypto.encrypt(JSON.stringify(before)));
    try {
      this.write(target);
      this.files.remove(this.path('pending.json'));
    } catch {
      this.recover();
      throw this.invalid();
    }
  }

  recover(): void {
    const raw = this.files.readRegularOptional(this.path('pending.json'));
    if (raw === undefined) {
      return;
    }
    try {
      this.write(this.decode(sealed.parse(JSON.parse(raw))));
      this.files.remove(this.path('pending.json'));
    } catch {
      throw new HttpError(409, ERROR_CODES.favoriteBackupRecoveryFailed, {
        code: ERROR_CODES.favoriteBackupRecoveryFailed,
      });
    }
  }

  private destinations() {
    return [
      ...(['favorites', 'profiles', 'vault', 'active', 'env'] as const).map((key) => ({
        key: `store/${key}`,
        path: this.environment.files[key],
      })),
      ...this.adapters.all().flatMap((adapter) =>
        adapter.targets().map((target) => ({
          key: `${adapter.id}/${target.key}`,
          path: target.path,
        })),
      ),
    ];
  }

  private capture(): Snapshot {
    return {
      version: 1,
      user: this.environment.dataDir,
      files: this.destinations().map((target) => {
        this.files.assertManaged(target.path);
        return { ...target, content: this.files.readOptional(target.path) ?? null };
      }),
    };
  }

  private decode(value: z.infer<typeof sealed>): Snapshot {
    try {
      const snapshot = snapshotSchema.parse(JSON.parse(this.crypto.decrypt(value)));
      const destinations = this.destinations();
      if (
        snapshot.user !== this.environment.dataDir ||
        snapshot.files.length !== destinations.length ||
        destinations.some((target, index) => {
          const saved = snapshot.files[index]!;
          return saved.key !== target.key || saved.path !== target.path;
        })
      ) {
        throw this.invalid();
      }
      return snapshot;
    } catch {
      throw this.invalid();
    }
  }

  private write(snapshot: Snapshot): void {
    const destinations = this.destinations();
    for (const target of destinations) {
      this.files.assertManaged(target.path);
    }
    for (const [index, target] of destinations.entries()) {
      const content = snapshot.files[index]!.content;
      if (content === null) {
        this.files.remove(target.path);
      } else {
        this.files.writeUserSecretFile(target.path, content);
      }
    }
  }

  private history(): z.infer<typeof historySchema> {
    const raw = this.files.readRegularOptional(this.path('history.json'));
    if (raw === undefined) {
      return { version: 1, entries: [] };
    }
    try {
      return historySchema.parse(JSON.parse(raw));
    } catch {
      throw this.invalid();
    }
  }

  private path(file: string): string {
    return join(this.environment.dataDir, 'favorite-backups', file);
  }

  private invalid(): HttpError {
    return new HttpError(409, ERROR_CODES.favoriteBackupInvalid, {
      code: ERROR_CODES.favoriteBackupInvalid,
    });
  }
}
