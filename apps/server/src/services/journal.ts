import { basename, join } from 'node:path';
import {
  ERROR_CODES,
  type HarnessId,
  isHarnessId,
  type OperationFile,
  type OperationKind,
  type OperationMetadataKey,
  type OperationReceipt,
  type OperationState,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IBackupService } from './backup';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';
import { IUserService } from './users';

const RECEIPT = 'receipt.json';
const METADATA_PREFIX = 'meta-';

const METADATA_KEYS: readonly OperationMetadataKey[] = ['profiles', 'active', 'vault'];

const OPERATION_KINDS: readonly OperationKind[] = [
  'activate',
  'activate-official',
  'revoke',
  'reapply',
  'import',
  'sync',
];

const OPERATION_STATES: readonly OperationState[] = [
  'prepared',
  'applying',
  'metadata-committed',
  'committed',
  'rolled-back',
  'degraded',
];

/** What an operation intends to change, declared before any of it happens. */
export type JournalPlan = {
  kind: OperationKind;
  harness: HarnessId;
  profile: string;
  backupId: string | null;
  files: OperationFile[];
  /** Store files the operation also rewrites, so an undo puts them back together. */
  metadata: OperationMetadataKey[];
};

/** Drives one record through the state machine; every call persists immediately. */
export type OperationHandle = {
  readonly id: string;
  applying(): void;
  metadataCommitted(): void;
  committed(): void;
  /** The in-process rollback already put everything back. */
  rolledBack(): void;
  /** Something could not be put back and needs a human. */
  degraded(note: string): void;
};

export interface IJournalService {
  readonly _serviceBrand: undefined;
  begin(plan: JournalPlan): OperationHandle;
  list(): OperationReceipt[];
  detail(id: string): OperationReceipt;
  /** Puts the live files and the store back to how they were before the operation. */
  undo(id: string): OperationReceipt;
  /**
   * Finishes whatever a crash left open, for every account this service may manage.
   * Never throws: a service that cannot recover still has to start.
   */
  recoverAll(): void;
}

export const IJournalService = createDecorator<IJournalService>('journalService');

/**
 * A durable record of each operation, so a power cut or SIGKILL in the middle of one
 * does not leave the native files, the store and the active pointer describing three
 * different states. The in-process rollback in LiveWriteService handles a thrown error;
 * this handles the process never getting to run that catch block.
 *
 * Records live in the selected user's own data directory alongside their backups, so on
 * a root-run service the managed account can rewrite them. Nothing read back is used as
 * a destination: metadata is referenced by a fixed key, never by path, and the live
 * files are put back through the backup service, which re-derives its own paths.
 */
@inject(IEnvironmentService, IFileService, IBackupService, IUserService, ILogService)
export class JournalService implements IJournalService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly backups: IBackupService,
    private readonly users: IUserService,
    private readonly log: ILogService,
  ) {}

  begin(plan: JournalPlan): OperationHandle {
    const id = this.nextId(plan);
    const dir = join(this.environment.journalDir, id);
    this.files.ensureDir(dir);

    // Snapshotted before the operation runs, which is the only moment the previous
    // store content is still available.
    for (const key of plan.metadata) {
      const content = this.files.readOptional(this.environment.files[key]);
      this.files.writeSecure(
        join(dir, `${METADATA_PREFIX}${key}`),
        content === undefined ? '' : content,
      );
      if (content === undefined) {
        this.files.writeSecure(join(dir, `${METADATA_PREFIX}${key}.absent`), '');
      }
    }

    const receipt: OperationReceipt = {
      id,
      state: 'prepared',
      kind: plan.kind,
      harness: plan.harness,
      profile: plan.profile,
      user: this.environment.currentUser.username,
      startedAt: new Date().toISOString(),
      backupId: plan.backupId,
      files: plan.files,
      metadata: plan.metadata,
      undoable: true,
    };
    this.write(dir, receipt);
    this.rotate(id);

    const advance = (state: OperationState, note?: string): void => {
      const finished = state !== 'applying';
      this.write(dir, {
        ...receipt,
        state,
        note,
        undoable: state !== 'rolled-back',
        ...(finished ? { finishedAt: new Date().toISOString() } : {}),
      });
    };

    return {
      id,
      applying: () => advance('applying'),
      metadataCommitted: () => advance('metadata-committed'),
      committed: () => advance('committed'),
      rolledBack: () => advance('rolled-back'),
      degraded: (note: string) => advance('degraded', note),
    };
  }

  list(): OperationReceipt[] {
    return this.load()
      .map(({ receipt }) => this.withUndoable(receipt))
      .toSorted((left, right) => right.id.localeCompare(left.id));
  }

  detail(id: string): OperationReceipt {
    return this.withUndoable(this.require(id).receipt);
  }

  undo(id: string): OperationReceipt {
    const { dir, receipt } = this.require(id);
    if (receipt.state === 'rolled-back') {
      throw new HttpError(409, '该操作已经撤销过了', {
        code: ERROR_CODES.operationAlreadyUndone,
      });
    }
    if (receipt.state === 'applying' || receipt.state === 'prepared') {
      throw new HttpError(409, '该操作尚未完成，请先等待或重启服务让它自动恢复', {
        code: ERROR_CODES.operationIncomplete,
      });
    }
    this.revert(dir, receipt);
    const reverted: OperationReceipt = {
      ...receipt,
      state: 'rolled-back',
      undoable: false,
      finishedAt: new Date().toISOString(),
      note: '已由用户撤销',
    };
    this.write(dir, reverted);
    return reverted;
  }

  recoverAll(): void {
    const accounts = this.manageableUsers();
    for (const user of accounts) {
      try {
        this.environment.runAsUser(user, () => this.recoverCurrentUser());
      } catch (error) {
        this.log.error(`journal recovery failed for ${user.username}`, error);
      }
    }
  }

  /**
   * `prepared` and `applying` may be half applied, so they get rolled back.
   * `metadata-committed` already changed everything it meant to; only the final marker
   * is missing, so it rolls forward rather than undoing a successful switch.
   */
  private recoverCurrentUser(): void {
    for (const { dir, receipt } of this.load(true)) {
      if (receipt.state === 'metadata-committed') {
        this.write(dir, { ...receipt, state: 'committed', finishedAt: new Date().toISOString() });
        this.log.warn(`operation ${receipt.id} was already applied; marked committed`);
        continue;
      }
      if (receipt.state !== 'prepared' && receipt.state !== 'applying') {
        continue;
      }
      try {
        this.revert(dir, receipt);
        this.write(dir, {
          ...receipt,
          state: 'rolled-back',
          undoable: false,
          finishedAt: new Date().toISOString(),
          note: '服务重启后自动回滚',
        });
        this.log.warn(`rolled back unfinished operation ${receipt.id}`);
      } catch (error) {
        this.write(dir, {
          ...receipt,
          state: 'degraded',
          finishedAt: new Date().toISOString(),
          note: `自动回滚失败：${error instanceof Error ? error.message : String(error)}`,
        });
        this.log.error(`could not roll back operation ${receipt.id}`, error);
      }
    }
  }

  /** Restores the native files from the backup, then the store files from the record. */
  private revert(dir: string, receipt: OperationReceipt): void {
    if (receipt.backupId) {
      if (!this.backups.exists(receipt.backupId)) {
        throw new HttpError(409, `操作 ${receipt.id} 的备份 ${receipt.backupId} 已被轮换删除`, {
          code: ERROR_CODES.operationBackupMissing,
          params: { id: receipt.id, backupId: receipt.backupId },
        });
      }
      this.backups.restore(receipt.backupId);
    }
    for (const key of receipt.metadata) {
      if (!METADATA_KEYS.includes(key)) {
        throw new HttpError(400, `操作记录引用了未知的存储文件 ${key}`, {
          code: ERROR_CODES.operationStorageUnknown,
          params: { key },
        });
      }
      // The destination comes from the environment, never from the record.
      const destination = this.environment.files[key];
      if (this.files.exists(join(dir, `${METADATA_PREFIX}${key}.absent`))) {
        this.files.remove(destination);
        continue;
      }
      const snapshot = this.files.readRegularOptional(join(dir, `${METADATA_PREFIX}${key}`));
      if (snapshot === undefined) {
        throw new HttpError(500, `操作 ${receipt.id} 缺少 ${key} 的快照`, {
          code: ERROR_CODES.operationSnapshotMissing,
          params: { id: receipt.id, key },
        });
      }
      this.files.writeSecure(destination, snapshot);
    }
  }

  private withUndoable(receipt: OperationReceipt): OperationReceipt {
    if (!receipt.undoable) {
      return receipt;
    }
    const undoable =
      receipt.state !== 'rolled-back' &&
      (!receipt.backupId || this.backups.exists(receipt.backupId));
    return undoable === receipt.undoable ? receipt : { ...receipt, undoable };
  }

  private manageableUsers(): Array<{
    username: string;
    uid: number;
    gid: number;
    homeDir: string;
  }> {
    try {
      return this.users.list();
    } catch (error) {
      this.log.error('could not enumerate users for journal recovery', error);
      return [this.environment.defaultUser];
    }
  }

  private require(id: string): { dir: string; receipt: OperationReceipt } {
    if (id !== basename(id) || id === '.' || id === '..' || id.includes('\\')) {
      throw new HttpError(400, 'invalid operation id', { code: ERROR_CODES.operationInvalidId });
    }
    const dir = join(this.environment.journalDir, id);
    const receipt = this.parse(id, this.files.readJson<unknown>(join(dir, RECEIPT), null));
    if (!receipt) {
      throw new HttpError(404, 'operation not found', { code: ERROR_CODES.operationNotFound });
    }
    return { dir, receipt };
  }

  private load(unfinishedOnly = false): Array<{ dir: string; receipt: OperationReceipt }> {
    const found: Array<{ dir: string; receipt: OperationReceipt }> = [];
    for (const id of this.files.listDirectories(this.environment.journalDir)) {
      const dir = join(this.environment.journalDir, id);
      const receipt = this.parse(id, this.files.readJson<unknown>(join(dir, RECEIPT), null));
      if (!receipt) {
        this.log.error(`ignoring unreadable operation record in ${id}`);
        continue;
      }
      if (unfinishedOnly && isFinished(receipt.state)) {
        continue;
      }
      found.push({ dir, receipt });
    }
    return found;
  }

  private write(dir: string, receipt: OperationReceipt): void {
    this.files.writeJson(join(dir, RECEIPT), receipt);
  }

  /** The directory name is the id; the recorded one is only advisory. */
  private parse(id: string, value: unknown): OperationReceipt | null {
    if (!isRecord(value)) {
      return null;
    }
    const { state, kind, harness, profile, user, startedAt, backupId, files, metadata } = value;
    if (typeof state !== 'string' || !OPERATION_STATES.includes(state as OperationState)) {
      return null;
    }
    if (typeof kind !== 'string' || !OPERATION_KINDS.includes(kind as OperationKind)) {
      return null;
    }
    if (typeof harness !== 'string' || !isHarnessId(harness)) {
      return null;
    }
    if (typeof profile !== 'string' || typeof user !== 'string' || typeof startedAt !== 'string') {
      return null;
    }
    if (!Array.isArray(files) || !Array.isArray(metadata)) {
      return null;
    }
    const parsedFiles: OperationFile[] = [];
    for (const file of files) {
      if (!isRecord(file) || typeof file.key !== 'string' || typeof file.path !== 'string') {
        return null;
      }
      parsedFiles.push({ key: file.key, path: file.path, existed: file.existed === true });
    }
    const parsedMetadata: OperationMetadataKey[] = [];
    for (const key of metadata) {
      if (typeof key !== 'string' || !METADATA_KEYS.includes(key as OperationMetadataKey)) {
        return null;
      }
      parsedMetadata.push(key as OperationMetadataKey);
    }
    return {
      id,
      state: state as OperationState,
      kind: kind as OperationKind,
      harness,
      profile,
      user,
      startedAt,
      finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : undefined,
      backupId: typeof backupId === 'string' ? backupId : null,
      files: parsedFiles,
      metadata: parsedMetadata,
      undoable: value.undoable === true,
      note: typeof value.note === 'string' ? value.note : undefined,
    };
  }

  private nextId(plan: JournalPlan): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = `${plan.kind}-${plan.harness}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
    const base = `${stamp}-${slug}`;
    let candidate = base;
    let suffix = 1;
    while (this.files.exists(join(this.environment.journalDir, candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  /** `keep` protects the record being written from being rotated away by its own write. */
  private rotate(keep: string): void {
    const names = this.files.listDirectories(this.environment.journalDir).toSorted();
    let excess = names.length - this.environment.journalRetainCount;
    for (const name of names) {
      if (excess <= 0) {
        break;
      }
      if (name === keep) {
        continue;
      }
      this.files.remove(join(this.environment.journalDir, name));
      excess -= 1;
    }
  }
}

function isFinished(state: OperationState): boolean {
  return state === 'committed' || state === 'rolled-back' || state === 'degraded';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
