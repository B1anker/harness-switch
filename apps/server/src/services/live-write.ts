import type { ConfigFormat } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { assertParsable } from './adapters/serialize';
import { type FileSnapshot, IBackupService } from './backup';
import { IFileService } from './files';
import { ILogService } from './log';

export type PlannedWrite = {
  path: string;
  format: ConfigFormat;
  content: string;
  /** Credential-bearing native files are always written target-owned with mode 0600. */
  secret?: boolean;
};

export interface ILiveWriteService {
  readonly _serviceBrand: undefined;
  apply(harness: string, profile: string, writes: PlannedWrite[]): void;
  /**
   * Applies native files, runs a related storage mutation, and restores the files if that
   * mutation fails. This lets a credential-file write participate in a larger transaction.
   */
  transaction<T>(harness: string, profile: string, writes: PlannedWrite[], operation: () => T): T;
}

export const ILiveWriteService = createDecorator<ILiveWriteService>('liveWriteService');

@inject(IFileService, IBackupService, ILogService)
export class LiveWriteService implements ILiveWriteService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly files: IFileService,
    private readonly backups: IBackupService,
    private readonly log: ILogService,
  ) {}

  /**
   * Writes every planned file or none of them. Validation runs before the first byte
   * touches disk, and a failure halfway through restores the previous state, including
   * deleting files that did not exist before.
   */
  apply(harness: string, profile: string, writes: PlannedWrite[]): void {
    this.transaction(harness, profile, writes, () => undefined);
  }

  transaction<T>(harness: string, profile: string, writes: PlannedWrite[], operation: () => T): T {
    if (writes.length === 0) {
      return operation();
    }
    for (const write of writes) {
      assertParsable(write.format, write.path, write.content);
    }

    const snapshots: FileSnapshot[] = writes.map((write) => ({
      path: write.path,
      content: this.files.readOptional(write.path),
    }));
    this.backups.create(harness, profile, snapshots);

    const written: Array<{ snapshot: FileSnapshot; secret: boolean }> = [];
    try {
      for (const [index, write] of writes.entries()) {
        this.write(write);
        written.push({ snapshot: snapshots[index]!, secret: write.secret === true });
      }
      return operation();
    } catch (error) {
      this.rollback(written);
      throw error;
    }
  }

  private write(write: PlannedWrite): void {
    if (write.secret) {
      this.files.writeUserSecretFile(write.path, write.content);
      return;
    }
    this.files.writeUserFile(write.path, write.content);
  }

  private rollback(written: Array<{ snapshot: FileSnapshot; secret: boolean }>): void {
    for (const { snapshot, secret } of written.toReversed()) {
      try {
        if (snapshot.content === undefined) {
          this.files.remove(snapshot.path);
          continue;
        }
        if (secret) {
          this.files.writeUserSecretFile(snapshot.path, snapshot.content);
        } else {
          this.files.writeUserFile(snapshot.path, snapshot.content);
        }
      } catch (error) {
        this.log.error(`rollback failed for ${snapshot.path}`, error);
      }
    }
  }
}
