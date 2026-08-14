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
};

export interface ILiveWriteService {
  readonly _serviceBrand: undefined;
  apply(harness: string, profile: string, writes: PlannedWrite[]): void;
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
    if (writes.length === 0) {
      return;
    }

    for (const write of writes) {
      assertParsable(write.format, write.path, write.content);
    }

    const snapshots: FileSnapshot[] = writes.map((write) => ({
      path: write.path,
      content: this.files.readOptional(write.path),
    }));

    this.backups.create(harness, profile, snapshots);

    const written: FileSnapshot[] = [];
    try {
      for (const [index, write] of writes.entries()) {
        this.files.writeUserFile(write.path, write.content);
        written.push(snapshots[index]!);
      }
    } catch (error) {
      this.rollback(written);
      throw error;
    }
  }

  private rollback(written: FileSnapshot[]): void {
    for (const snapshot of written.toReversed()) {
      try {
        if (snapshot.content === undefined) {
          this.files.remove(snapshot.path);
          continue;
        }
        this.files.writeUserFile(snapshot.path, snapshot.content);
      } catch (error) {
        this.log.error(`rollback failed for ${snapshot.path}`, error);
      }
    }
  }
}
