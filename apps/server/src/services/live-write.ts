import type {
  ConfigFormat,
  HarnessId,
  OperationKind,
  OperationMetadataKey,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES, type OperationReceipt } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { assertParsable } from './adapters/serialize';
import { type FileSnapshot, IBackupService } from './backup';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IJournalService } from './journal';
import { ILogService } from './log';

export type PlannedWrite = {
  /** Adapter target key. Backups record it instead of the path, which they re-derive. */
  key: string;
  path: string;
  format: ConfigFormat;
  content: string;
  /** Credential-bearing native files are always written target-owned with mode 0600. */
  secret?: boolean;
};

/** One complete business operation: the native files plus the store files it commits. */
export type OperationPlan = {
  favoriteResult?: OperationReceipt['favoriteResult'];
  kind: OperationKind;
  harness: HarnessId;
  profile: string;
  writes: PlannedWrite[];
  /**
   * Store files the `operation` callback rewrites. They are snapshotted up front so an
   * undo or a crash recovery puts them back together with the native files, instead of
   * leaving the config on disk and the record of it disagreeing.
   */
  metadata?: OperationMetadataKey[];
  beforeWrites?: () => void;
  favoriteRequest?: {
    version: 1;
    requestId: string;
    planId: string;
    item: number;
    approvalHash: string;
    targets?: Array<{ harness: HarnessId; profile: string }>;
  };
};

export interface ILiveWriteService {
  readonly _serviceBrand: undefined;
  apply(plan: OperationPlan): void;
  /**
   * Applies native files, runs a related storage mutation, and restores the files if that
   * mutation fails. This lets a credential-file write participate in a larger transaction.
   */
  transaction<T>(plan: OperationPlan, operation: () => T): T;
}

export const ILiveWriteService = createDecorator<ILiveWriteService>('liveWriteService');

@inject(IFileService, IBackupService, IJournalService, ILogService, IEnvironmentService)
export class LiveWriteService implements ILiveWriteService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly files: IFileService,
    private readonly backups: IBackupService,
    private readonly journal: IJournalService,
    private readonly log: ILogService,
    private readonly environment: IEnvironmentService,
  ) {}

  /**
   * Writes every planned file or none of them. Validation runs before the first byte
   * touches disk, and a failure halfway through restores the previous state, including
   * deleting files that did not exist before.
   */
  apply(plan: OperationPlan): void {
    this.transaction(plan, () => undefined);
  }

  transaction<T>(plan: OperationPlan, operation: () => T): T {
    const { harness, profile, writes } = plan;
    for (const write of writes) {
      this.files.assertManaged(write.path);
      assertParsable(write.format, write.path, write.content);
    }

    const metadata = (plan.metadata ?? []).map((key) => ({
      path: this.environment.files[key],
      content: this.files.readOptional(this.environment.files[key]),
    }));
    const snapshots: FileSnapshot[] = writes.map((write) => ({
      key: write.key,
      path: write.path,
      content: this.files.readOptional(write.path),
    }));
    // Metadata-only operations (for example an import without an auth.json cache)
    // still need a durable receipt. They do not need a native-file backup, but the
    // journal snapshots their metadata so startup recovery can put it back.
    const backupId = writes.length === 0 ? null : this.backups.create(harness, profile, snapshots);

    // Opened before the first write so a crash between here and the commit leaves a
    // record the next start can act on. The in-process catch below only covers a thrown
    // error; it never runs for SIGKILL, OOM or a power cut.
    const entry = this.journal.begin({
      kind: plan.kind,
      harness,
      profile,
      backupId,
      files: snapshots.map((snapshot) => ({
        key: snapshot.key,
        path: snapshot.path,
        existed: snapshot.content !== undefined,
      })),
      metadata: plan.metadata ?? [],
      favoriteRequest: plan.favoriteRequest,
      favoriteResult: plan.favoriteResult,
    });

    const written: Array<{ snapshot: FileSnapshot; secret: boolean }> = [];
    try {
      entry.applying();
      plan.beforeWrites?.();
      for (const [index, write] of writes.entries()) {
        this.write(write);
        written.push({ snapshot: snapshots[index]!, secret: write.secret === true });
      }
      const result = operation();
      entry.metadataCommitted();
      entry.committed();
      return result;
    } catch (error) {
      let restored = this.rollback(written);
      for (const snapshot of metadata.toReversed()) {
        try {
          this.files.restore(snapshot.path, snapshot.content);
        } catch (restoreError) {
          restored = false;
          this.log.error('metadata rollback failed', restoreError);
        }
      }
      if (restored) {
        entry.rolledBack(error instanceof HttpError ? error.code : ERROR_CODES.requestFailed);
      } else {
        entry.degraded('回滚过程中有文件未能恢复，请从备份手动恢复');
      }
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

  /** Returns false when any file could not be put back, which the journal records. */
  private rollback(written: Array<{ snapshot: FileSnapshot; secret: boolean }>): boolean {
    let complete = true;
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
        complete = false;
      }
    }
    return complete;
  }
}
