import type { ErrorCode, LocalizedMessage, MessageParams } from './errors';
import type { HarnessId } from './harnesses';

/**
 * Response shapes live here. Request shapes live in `schemas.ts`, where the runtime
 * validator is the single source of truth and the type is inferred from it.
 */

/**
 * How a harness stores providers in its own config file.
 *
 * - `replace`: the live file holds exactly one provider, so activating replaces it.
 * - `additive`: the live file holds many providers plus a "current" pointer, so
 *   activating only moves the pointer and must leave other providers untouched.
 *
 * Writing an additive file as if it were a replace file destroys the providers the
 * user configured by hand.
 */
export type HarnessMode = 'replace' | 'additive';

export type ConfigFormat = 'json' | 'toml' | 'yaml' | 'text';

export type FieldOption = {
  value: string;
  label: string;
};

/**
 * Describes one harness-specific field so the web UI can render the form without
 * duplicating each harness schema. Core fields (name, base URL, API key, model,
 * notes) are always rendered and are not part of this list.
 */
export type FieldSpec = {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'select' | 'textarea';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: FieldOption[];
  defaultValue?: string;
  /** Lets schema-driven forms place this field on its own row. */
  fullWidth?: boolean;
};

/** One native config file a harness owns. */
export type TargetSpec = {
  key: string;
  label: string;
  path: string;
  format: ConfigFormat;
};

export type ProfilePublic = {
  harness: HarnessId;
  name: string;
  baseUrl: string;
  model: string;
  notes: string;
  extras: Record<string, string>;
  /** Target keys whose content the user has taken over in the advanced editor. */
  overriddenTargets: string[];
  /** Optional reference to a Provider Vault entry that owns this profile's credential. */
  providerId?: string;
  /** Optional named endpoint under the vault entry; its base URL wins when set. */
  providerEndpoint?: string;
  updatedAt: string;
};

export type ActivePublic = {
  name: string;
  baseUrl: string;
  model: string;
  /** True when the harness is using its own built-in account login. */
  official?: boolean;
};

export type HarnessSummary = {
  id: HarnessId;
  label: string;
  mode: HarnessMode;
  active: ActivePublic | null;
  profiles: ProfilePublic[];
  fields: FieldSpec[];
  /** Whether the core model field is required by this harness adapter. */
  modelRequired?: boolean;
  targets: TargetSpec[];
  /** Environment variables this harness actually honours, for the env.sh layer. */
  envVars: string[];
  /** Set when the harness ignores shell environment variables entirely. */
  envNote?: string;
  /** Whether this harness can safely return to its built-in account login. */
  supportsOfficialAuth?: boolean;
};

export type HarnessesResponse = {
  envFile: string;
  items: HarnessSummary[];
};

export type SessionResponse = {
  authenticated: boolean;
  currentUser: string;
};

export type LocalUserPublic = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
  current: boolean;
  /**
   * Whether this process can actually manage the account's configuration. False means
   * selecting it would only fail later at write time, so the switch is refused up front.
   *
   * This describes the manager's authority, not the account: the same account is
   * manageable when the service runs as root and unmanageable when it does not.
   */
  manageable: boolean;
  /** Why `manageable` is false. See `USER_BLOCK_CODES`. */
  blockCode?: string;
  /** Values `blockCode` interpolates. Data, never keys. */
  blockParams?: MessageParams;
  /** The server's own prose for the block, printed by the CLI and used as the UI's fallback. */
  blockReason?: string;
};

export type UsersResponse = {
  currentUser: string;
  items: LocalUserPublic[];
};

/** Presence metadata only; cache contents are never returned in a preview. */
export type CodexLoginCacheState = {
  available: boolean;
  targetExists: boolean;
  /** True only when the source cache would change the target cache. */
  migrationNeeded: boolean;
};

export type UserSyncPreview = {
  sourceUser: string;
  targetUser: string;
  profileCount: number;
  providerCount: number;
  conflicts: TransferConflict[];
  codexLoginCache: CodexLoginCacheState;
};

export type UserSyncResponse = {
  ok: true;
  sourceUser: string;
  targetUser: string;
  imported: number;
  overwritten: number;
  skipped: number;
  providersCopied: number;
  codexLoginCacheMigrated: boolean;
  warnings: LocalizedMessage[];
};

/** One rendered config file, as it would be written to disk. */
export type PreviewTarget = {
  key: string;
  label: string;
  path: string;
  format: ConfigFormat;
  content: string;
  /** True when the content comes from a user override instead of the form fields. */
  overridden: boolean;
  /** The live file content right now; null when the file is absent on disk. */
  currentContent: string | null;
};

export type PreviewResponse = {
  targets: PreviewTarget[];
};

export type ActivateResponse = {
  ok: true;
  envFile: string;
  /** Non-fatal problems from steps that ran after the switch already committed. */
  warnings: LocalizedMessage[];
};

export type BackupFileEntry = {
  path: string;
  existed: boolean;
};

export type BackupEntry = {
  id: string;
  createdAt: string;
  harness: string;
  profile: string;
  files: BackupFileEntry[];
  /** True when every file in the snapshot already matches what is on disk. */
  current: boolean;
};

export type BackupFileDetail = {
  path: string;
  existed: boolean;
  /** Snapshot content; null when the file did not exist at backup time. */
  content: string | null;
  /** Live file content now; null when the file is absent on disk. */
  currentContent: string | null;
};

export type BackupDetail = {
  id: string;
  createdAt: string;
  harness: string;
  profile: string;
  files: BackupFileDetail[];
};

export type BackupsResponse = {
  items: BackupEntry[];
};

export type TransferEnvelope = {
  format: 'harness-switch-encrypted-export';
  version: 1;
  kdf: {
    name: 'scrypt';
    salt: string;
  };
  cipher: {
    name: 'aes-256-gcm';
    iv: string;
    tag: string;
    data: string;
  };
};

export type TransferConflict = {
  harness: HarnessId;
  name: string;
};

export type TransferHarnessCount = {
  harness: HarnessId;
  profiles: number;
};

export type TransferExportPreview = {
  codexLoginCacheAvailable: boolean;
};

/** Secret-free description of how restoring an active Codex state may touch auth.json. */
export type CodexAuthJsonEffect = 'none' | 'openai-api-key' | 'auth-override' | 'official-cleanup';

export type TransferPreview = {
  exportedAt: string;
  profileCount: number;
  /** Number of Provider Vault entries bundled with the encrypted export. */
  providerCount: number;
  harnesses: TransferHarnessCount[];
  conflicts: TransferConflict[];
  activeCount: number;
  /** Options used to calculate this preview; clients must re-check after changing either. */
  conflictPolicy: TransferConflictPolicy;
  restoreActive: boolean;
  /** Potential auth.json change caused by restoring the selected active state. */
  codexActivationAuthEffect: CodexAuthJsonEffect;
  codexLoginCache: CodexLoginCacheState;
};

export type TransferConflictPolicy = 'skip' | 'overwrite';

export type TransferImportResponse = {
  ok: true;
  imported: number;
  overwritten: number;
  skipped: number;
  /** Provider Vault entries recreated from the encrypted export. */
  providersCopied: number;
  activeRestored: number;
  codexLoginCacheMigrated: boolean;
  warnings: LocalizedMessage[];
};

export type OkResponse = {
  ok: true;
};

export type ErrorResponse = {
  /** Human-readable prose. Always present so the CLI and older clients keep working. */
  error: string;
  /** Stable identifier the web UI translates; absent for not-yet-migrated errors. */
  code?: ErrorCode;
  params?: MessageParams;
};

/* ------------------------------------------------------------------ */
/* Provider Vault                                                      */
/* ------------------------------------------------------------------ */

/**
 * One named endpoint under a vault entry. `key` is the identifier profiles
 * reference; `baseUrl` is not a secret.
 */
export type ProviderEndpoint = {
  key: string;
  label: string;
  baseUrl: string;
};

/** A vault entry as seen by callers: the API key itself is never exposed. */
export type ProviderPublic = {
  id: string;
  name: string;
  endpoints: ProviderEndpoint[];
  notes?: string;
  /** True when a credential is stored for this entry. */
  apiKeyConfigured: boolean;
  updatedAt: string;
};

export type ProvidersResponse = {
  items: ProviderPublic[];
};

export type ProviderMutationResponse = {
  provider: ProviderPublic;
  /** Non-fatal problems while re-applying profiles that reference this entry. */
  warnings: LocalizedMessage[];
};

/* ------------------------------------------------------------------ */
/* Connectivity probe                                                  */
/* ------------------------------------------------------------------ */

/**
 * Outcome of one connectivity probe against a base URL.
 *
 * Endpoint-side conditions (unreachable, rejected credential, non-JSON body) are
 * reported here rather than thrown, so the UI can render the result next to the
 * button that triggered it. Only request-shape problems are rejected upstream by
 * the schema. The credential itself never appears anywhere in this shape.
 */
export type ProbeResult = {
  ok: boolean;
  /** HTTP status of the response that decided the outcome; absent for network failures. */
  status?: number;
  /** Round-trip time of that request in milliseconds. */
  latencyMs?: number;
  /** The URL that produced the outcome, after `/v1` normalization and fallback. */
  requestUrl?: string;
  /** Model ids from the catalog, in the order the endpoint returned them, deduped. */
  models?: string[];
  /** Stable machine-readable failure reason; see `PROBE_CODES`. */
  code?: string;
  /** Values the UI interpolates into the translated message for `code`. */
  params?: MessageParams;
  /** Server prose for the same failure; kept for the CLI and as UI fallback. */
  message?: string;
};

export type ProbeResponse = {
  result: ProbeResult;
};

/* ------------------------------------------------------------------ */
/* Drift                                                               */
/* ------------------------------------------------------------------ */

export type DriftStatus = 'in-sync' | 'drifted' | 'missing' | 'invalid' | 'unknown';

/**
 * One target file compared against what the active profile would render.
 * Field names align with BackupFileDetail so the frontend diff view can reuse them.
 */
export type DriftFileState = {
  key: string;
  label: string;
  path: string;
  format: ConfigFormat;
  /** The content the active profile would write; null when nothing is expected. */
  expectedContent: string | null;
  /** The live file content right now; null when the file is absent on disk. */
  currentContent: string | null;
  status: DriftStatus;
};

export type DriftSummary = {
  harness: HarnessId;
  status: DriftStatus;
  /** True when a profile is active for this harness. */
  active: boolean;
  files: DriftFileState[];
};

export type DriftResponse = {
  items: DriftSummary[];
};

export type DriftReapplyResponse = {
  ok: true;
  files: DriftFileState[];
};

export type DriftAdoptResponse = {
  ok: true;
  summary: DriftSummary;
  /** Non-fatal problems while reading the live files back. */
  warnings: LocalizedMessage[];
};

/** Request body for POST /api/drift/:harnessId/adopt (no options yet). */
export type AdoptRequest = object;

/** Request body for POST /api/drift/:harnessId/reapply (no options yet). */
export type ApproveDriftRequest = object;

/* ------------------------------------------------------------------ */
/* Scan and import                                                     */
/* ------------------------------------------------------------------ */

/** One config file the scan looked at, so the wizard can say where it read from. */
export type ScanSource = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  /** False when the file is there but the tool's own parser would reject it. */
  parsable: boolean;
};

/** A provider found in a tool's own config, offered for import. */
export type ScanCandidate = {
  /** Stable handle the import request refers back to. */
  id: string;
  harness: HarnessId;
  /** The provider id as it appears in the tool's own file. */
  sourceKey: string;
  suggestedName: string;
  baseUrl: string;
  model: string;
  extras: Record<string, string>;
  /**
   * Masked credential. The plaintext never leaves the server: an import re-reads it
   * from disk rather than taking it back from the browser.
   */
  apiKeyPreview: string;
  apiKeyPresent: boolean;
  /** True when the tool is currently pointed at this provider. */
  active: boolean;
  /** Set when a profile of the suggested name already exists. */
  conflictsWith?: string;
  /** Set when a vault entry already holds this exact credential. */
  matchesProvider?: string;
};

export type ScanHarnessResult = {
  harness: HarnessId;
  label: string;
  sources: ScanSource[];
  candidates: ScanCandidate[];
  /** Explains an empty candidate list. The server's own prose, printed by the CLI. */
  note?: string;
  /** The same explanation as a stable code the web UI can translate. See `SCAN_NOTE_CODES`. */
  noteCode?: string;
};

export type ScanResponse = {
  items: ScanHarnessResult[];
};

export type ScanImportResponse = {
  ok: true;
  imported: number;
  skipped: number;
  providersCreated: number;
  /** Non-fatal problems; the successful selections are still saved. */
  warnings: LocalizedMessage[];
};

/* ------------------------------------------------------------------ */
/* Operation journal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where an operation got to before the process stopped looking at it.
 *
 * The boundary that matters for crash recovery is `metadata-committed`: everything the
 * operation set out to change is already on disk by then, so a restart rolls it forward
 * to `committed` instead of undoing work that actually succeeded. Anything still at
 * `applying` may be half written and gets rolled back.
 */
export type OperationState =
  | 'prepared'
  | 'applying'
  | 'metadata-committed'
  | 'committed'
  | 'rolled-back'
  | 'degraded';

export type OperationKind =
  | 'activate'
  | 'activate-official'
  | 'revoke'
  | 'reapply'
  | 'import'
  | 'sync';

/** Store files an operation changed alongside the native config files. */
export type OperationMetadataKey = 'profiles' | 'active' | 'vault';

export type OperationFile = {
  key: string;
  path: string;
  /** Whether the file existed before the operation; an undo deletes it again if not. */
  existed: boolean;
};

/** The audit record and undo point for one complete business operation. */
export type OperationReceipt = {
  id: string;
  state: OperationState;
  kind: OperationKind;
  harness: HarnessId;
  profile: string;
  /** The Unix account the operation was performed for. */
  user: string;
  startedAt: string;
  finishedAt?: string;
  /** Snapshot holding the previous content of every file below. */
  backupId: string | null;
  files: OperationFile[];
  metadata: OperationMetadataKey[];
  /** False once the snapshot has been rotated away or the operation was already undone. */
  undoable: boolean;
  /** Why a recovery could not finish cleanly. */
  note?: string;
};

export type OperationsResponse = {
  items: OperationReceipt[];
};

export type OperationUndoResponse = {
  ok: true;
  receipt: OperationReceipt;
};

/* ------------------------------------------------------------------ */
/* Doctor                                                              */
/* ------------------------------------------------------------------ */

export type DoctorCheckStatus = 'ok' | 'warn' | 'error' | 'unknown';

export type DoctorCheck = {
  id: string;
  /** The server's own prose, printed by the CLI and used as the UI's fallback. */
  label: string;
  status: DoctorCheckStatus;
  /**
   * Stable identifier for what this check reports, so the web UI can render the
   * same fact in the viewer's language. See `DOCTOR_CODES`.
   */
  code?: string;
  /** Values `code` interpolates — paths, modes, counts. Data, never keys. */
  params?: MessageParams;
  /** Human-readable message plus machine-readable extras. */
  detail?: unknown;
};

export type DoctorReport = {
  harness: HarnessId;
  checks: DoctorCheck[];
};

export type DoctorResponse = {
  items: DoctorReport[];
  /** True when a newer release exists on the registry. */
  updatedAvailable: boolean;
};
