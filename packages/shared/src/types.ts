import type { HarnessId } from './harnesses';

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
};

export type UsersResponse = {
  currentUser: string;
  items: LocalUserPublic[];
};

/** Presence metadata only; cache contents are never returned in a preview. */
export type CodexLoginCacheState = {
  available: boolean;
  targetExists: boolean;
};

export type UserSyncRequest = {
  sourceUser: string;
  conflictPolicy?: TransferConflictPolicy;
  /** Explicitly copy the source user's Codex official-login cache. Defaults to false. */
  migrateCodexLoginCache?: boolean;
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
  warnings: string[];
};

export type LoginRequest = {
  password: string;
};

export type CreateProfileRequest = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
  /** Reference a Provider Vault entry instead of an inline apiKey. */
  providerId?: string;
  /** Named endpoint under the vault entry; its base URL wins over baseUrl. */
  providerEndpoint?: string;
};

export type UpdateProfileRequest = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
  /** Set to a vault entry id to reference it; set to '' (with apiKey) to detach. */
  providerId?: string;
  providerEndpoint?: string;
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
  warnings: string[];
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
  activeRestored: number;
  codexLoginCacheMigrated: boolean;
  warnings: string[];
};

export type OkResponse = {
  ok: true;
};

export type ErrorResponse = {
  error: string;
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

export type CreateProviderRequest = {
  name: string;
  apiKey: string;
  endpoints?: ProviderEndpoint[];
  notes?: string;
};

export type UpdateProviderRequest = {
  name?: string;
  /** Present and non-empty rotates the credential; empty or absent keeps it. */
  apiKey?: string;
  /** Full replacement of the named endpoints. */
  endpoints?: ProviderEndpoint[];
  notes?: string;
};

export type ProviderMutationResponse = {
  provider: ProviderPublic;
  /** Non-fatal problems while re-applying profiles that reference this entry. */
  warnings: string[];
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
  warnings: string[];
};

/** Request body for POST /api/drift/:harnessId/adopt (no options yet). */
export type AdoptRequest = object;

/** Request body for POST /api/drift/:harnessId/reapply (no options yet). */
export type ApproveDriftRequest = object;

/* ------------------------------------------------------------------ */
/* Doctor                                                              */
/* ------------------------------------------------------------------ */

export type DoctorCheckStatus = 'ok' | 'warn' | 'error' | 'unknown';

export type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorCheckStatus;
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
