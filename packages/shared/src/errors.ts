/**
 * Stable machine-readable identifiers for server-reported problems.
 *
 * The web UI translates these into the viewer's language, so the code — not the
 * prose — is the contract. Responses keep a human-readable `message` alongside the
 * code: the CLI prints it, and the browser falls back to it for codes it does not
 * know yet. Renaming a code is a breaking change; add a new one instead.
 */
export const ERROR_CODES = {
  /* Transport and session */
  requestFailed: 'http.requestFailed',
  invalidRequest: 'http.invalidRequest',
  internalServerError: 'http.internalServerError',
  authenticationRequired: 'http.authenticationRequired',
  crossOriginDenied: 'http.crossOriginDenied',
  invalidPassword: 'auth.invalidPassword',
  missingArgument: 'cli.missingArgument',
  invalidConflictPolicy: 'sync.invalidConflictPolicy',

  /* Files and harnesses */
  harnessNotFound: 'harness.notFound',
  fileNotRegular: 'file.notRegular',
  fileOutsideManagedDirectory: 'file.outsideManagedDirectory',
  fileOwnershipRequiresRoot: 'file.ownershipRequiresRoot',
  nativeConfigInvalid: 'adapter.nativeConfigInvalid',
  adapterUnknownTarget: 'adapter.unknownTarget',

  /* Profiles and adapter validation */
  profileActiveDeleteForbidden: 'profile.activeDeleteForbidden',
  profileAlreadyExists: 'profile.alreadyExists',
  profileNotFound: 'profile.notFound',
  profileEndpointNotFound: 'profile.endpointNotFound',
  profileApiKeyRequired: 'profile.apiKeyRequired',
  profileNameRequired: 'profile.nameRequired',
  profileNameInvalid: 'profile.nameInvalid',
  profileNameTooLong: 'profile.nameTooLong',
  adapterModelRequired: 'adapter.modelRequired',
  adapterApiKeyRequired: 'adapter.apiKeyRequired',

  /* Activation and drift */
  officialLoginUnsupported: 'activation.officialLoginUnsupported',
  officialLoginMissing: 'activation.officialLoginMissing',
  officialApiKeyMissing: 'activation.officialApiKeyMissing',
  noActiveProfile: 'activation.noActiveProfile',
  officialProfileCannotAdopt: 'activation.officialProfileCannotAdopt',
  adoptUnsupported: 'activation.adoptUnsupported',
  manualOverridesPreventAdopt: 'activation.manualOverridesPreventAdopt',
  officialProfileAlreadyExists: 'activation.officialProfileAlreadyExists',

  /* Provider vault */
  providerInUse: 'provider.inUse',
  providerCredentialUnreadable: 'provider.credentialUnreadable',
  providerNotFound: 'provider.notFound',
  providerNameRequired: 'provider.nameRequired',
  providerApiKeyRequired: 'provider.apiKeyRequired',
  providerEndpointsInvalid: 'provider.endpointsInvalid',
  providerEndpointKeyRequired: 'provider.endpointKeyRequired',
  providerEndpointKeyInvalid: 'provider.endpointKeyInvalid',
  providerEndpointKeyDuplicate: 'provider.endpointKeyDuplicate',
  providerEndpointUrlRequired: 'provider.endpointUrlRequired',

  /* Codex login cache */
  codexCacheTooLarge: 'codex.loginCacheTooLarge',
  codexCacheInvalidJson: 'codex.loginCacheInvalidJson',
  codexConfigDirNotRegular: 'codex.configDirectoryNotRegular',
  codexCacheNotRegular: 'codex.loginCacheNotRegular',

  /* Transfer and cross-user sync */
  transferEnvelopeInvalid: 'transfer.envelopeInvalid',
  syncSourceCacheMissing: 'sync.sourceCodexLoginCacheMissing',
  syncSourceEqualsTarget: 'sync.sourceEqualsTarget',
  scanApiKeyRequired: 'scan.apiKeyRequired',

  /* Backups and journal */
  backupTargetInvalid: 'backup.targetInvalid',
  backupInvalidId: 'backup.invalidId',
  backupNotFound: 'backup.notFound',
  backupFileNotOwned: 'backup.fileNotOwned',
  backupPayloadMissing: 'backup.payloadMissing',
  backupPayloadNameInvalid: 'backup.payloadNameInvalid',
  operationAlreadyUndone: 'operation.alreadyUndone',
  operationIncomplete: 'operation.incomplete',
  operationBackupMissing: 'operation.backupMissing',
  operationStorageUnknown: 'operation.storageUnknown',
  operationSnapshotMissing: 'operation.snapshotMissing',
  operationInvalidId: 'operation.invalidId',
  operationNotFound: 'operation.notFound',

  /* GitHub sync */
  githubNotConnected: 'github.notConnected',
  githubAuthFailed: 'github.authFailed',
  githubGistNotFound: 'github.gistNotFound',
  githubDeviceCodeExpired: 'github.deviceCodeExpired',
  githubRateLimitExceeded: 'github.rateLimitExceeded',

  /* Local users and persistent storage */
  userNotManageable: 'user.notManageable',
  userNotSwitchable: 'user.notSwitchable',
  storageUnreadable: 'storage.unreadable',
  storageQuarantineFailed: 'storage.quarantineFailed',
  storageCorruptQuarantined: 'storage.corruptQuarantined',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Values a localized message interpolates. Deliberately primitive: params travel
 * as JSON and are rendered as data, never parsed as further translation keys.
 */
export type MessageParams = Record<string, string | number | boolean>;

/**
 * Non-fatal problems reported alongside a successful result.
 *
 * `message` is the server's own prose, kept so the CLI and older clients keep
 * working. `code` lets the web UI render the viewer's language instead.
 */
export type LocalizedMessage = {
  message: string;
  code?: string;
  params?: MessageParams;
  /** Standard API response fields, added by the HTTP boundary for newer clients. */
  data?: MessageParams;
  msg?: string;
  /**
   * Verbatim prefix rendered before the translated text, e.g. `codex/my-profile`.
   * It carries user data (harness id and profile name), so it is never translated —
   * that keeps a nested warning's own `code` usable instead of flattening it to prose.
   */
  scope?: string;
};

/** Codes for problems reported next to an otherwise successful response. */
export const WARNING_CODES = {
  envRebuildFailed: 'warning.activation.envRebuildFailed',
  officialEnvRebuildFailed: 'warning.activation.officialEnvRebuildFailed',
  backfillFailed: 'warning.activation.backfillFailed',
  endpointFallback: 'warning.provider.endpointFallback',
  reapplyFailed: 'warning.provider.reapplyFailed',
  syncReapplyFailed: 'warning.sync.activeReapplyFailed',
  transferActiveRestoreFailed: 'warning.transfer.activeRestoreFailed',
} as const;

export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

/**
 * Codes for the individual doctor checks.
 *
 * A check reports a fact about the local machine, so it needs the same treatment as an
 * error: the server keeps its prose `label` for the CLI, and the code plus `params` let
 * the web UI render the same fact in the viewer's language.
 */
export const DOCTOR_CODES = {
  installFound: 'doctor.check.installFound',
  installMissing: 'doctor.check.installMissing',
  installNotRequired: 'doctor.check.installNotRequired',
  fileMissing: 'doctor.check.fileMissing',
  fileUnreadable: 'doctor.check.fileUnreadable',
  fileUnwritable: 'doctor.check.fileUnwritable',
  filePermissive: 'doctor.check.filePermissive',
  fileOk: 'doctor.check.fileOk',
  parseOk: 'doctor.check.parseOk',
  parseFailed: 'doctor.check.parseFailed',
  parseUnreadable: 'doctor.check.parseUnreadable',
  driftNoProfile: 'doctor.check.driftNoProfile',
  driftInvalid: 'doctor.check.driftInvalid',
  driftMismatch: 'doctor.check.driftMismatch',
  driftInSync: 'doctor.check.driftInSync',
  probeNoProfile: 'doctor.check.probeNoProfile',
  probeOfficialLogin: 'doctor.check.probeOfficialLogin',
  probeMissingCredential: 'doctor.check.probeMissingCredential',
  probeOk: 'doctor.check.probeOk',
  probeFailed: 'doctor.check.probeFailed',
} as const;

export type DoctorCode = (typeof DOCTOR_CODES)[keyof typeof DOCTOR_CODES];

/**
 * Codes for the note explaining why a scanned harness offered nothing to import.
 *
 * Same split as everywhere else: the prose stays in `note` for the CLI, the code lets
 * the web UI say it in the viewer's language.
 */
export const SCAN_NOTE_CODES = {
  unsupported: 'scan.note.unsupported',
  noConfigFiles: 'scan.note.noConfigFiles',
  unparsable: 'scan.note.unparsable',
  noCandidates: 'scan.note.noCandidates',
} as const;

export type ScanNoteCode = (typeof SCAN_NOTE_CODES)[keyof typeof SCAN_NOTE_CODES];

/**
 * Codes for a connectivity probe result.
 *
 * A probe never throws to the HTTP layer for conditions the endpoint itself caused:
 * the outcome travels as a structured result so the UI can render it next to the
 * button that triggered it, and the code — not the prose — is what translates.
 */
export const PROBE_CODES = {
  /** The URL does not parse or its scheme is not http/https. */
  badUrl: 'probe.badUrl',
  /** Nothing to test against: no base URL was supplied or resolvable. */
  missingBaseUrl: 'probe.missingBaseUrl',
  /** No credential was supplied and none could be resolved from the vault or store. */
  missingApiKey: 'probe.missingApiKey',
  /** The request did not answer within the timeout window. */
  timeout: 'probe.timeout',
  /** The request failed before an HTTP response existed (DNS, refused, TLS). */
  networkError: 'probe.networkError',
  /** The endpoint answered 401/403: reachable, but the credential is rejected. */
  unauthorized: 'probe.unauthorized',
  /** The endpoint answered with another non-2xx status. */
  httpError: 'probe.httpError',
  /** A 2xx response arrived but its body is not JSON in any known catalog shape. */
  invalidResponse: 'probe.invalidResponse',
} as const;

export type ProbeCode = (typeof PROBE_CODES)[keyof typeof PROBE_CODES];

/**
 * Codes for why the manager cannot take over another local user's configuration.
 *
 * Same split as everywhere else: the server keeps prose in `reason` for the CLI, and
 * the code plus `params` let the web UI explain the block in the viewer's language.
 * These describe the *manager's* authority over an account, not the account itself —
 * running the service as root makes every one of them disappear.
 */
export const USER_BLOCK_CODES = {
  /** The home directory cannot be traversed, so no path inside it can be resolved. */
  homeUnsearchable: 'user.block.homeUnsearchable',
  /** The home directory can be entered but not written, so no store can be created. */
  homeUnwritable: 'user.block.homeUnwritable',
  /** The existing store directory cannot be read or written. */
  storeInaccessible: 'user.block.storeInaccessible',
  /** Files would have to be chowned to another uid, which needs root. */
  ownershipRequiresRoot: 'user.block.ownershipRequiresRoot',
  /** The home directory recorded for the account is gone. */
  homeMissing: 'user.block.homeMissing',
} as const;

export type UserBlockCode = (typeof USER_BLOCK_CODES)[keyof typeof USER_BLOCK_CODES];
