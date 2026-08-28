import { z } from 'zod';
import { HARNESS_IDS } from './harnesses';

/**
 * Request shapes, validated at the HTTP boundary before anything reaches the store.
 *
 * The stored profile is what the adapters later render from, so a value they cannot
 * express has to be rejected here. Otherwise a malformed body is persisted happily and
 * only surfaces as a 500 the next time the profile is activated.
 *
 * Unknown keys are stripped rather than rejected, so an older client sending a field
 * this version dropped still works while nothing unrecognised reaches disk.
 */

const MAX_NAME = 120;
const MAX_URL = 2048;
const MAX_NOTES = 4096;
const MAX_KEY = 4096;
const MAX_EXTRA_VALUE = 4096;
/** An override is a whole config file the user took over, so it needs real headroom. */
const MAX_OVERRIDE = 1024 * 1024;

/** Names become object keys in the store and slugs in backup directory names. */
const entityName = z
  .string()
  .trim()
  .min(1, '名称不能为空')
  .max(MAX_NAME, `名称不能超过 ${MAX_NAME} 个字符`)
  .refine((value) => !value.includes('/') && !value.includes('\\'), '名称不能包含斜杠');

const optionalText = (max: number) => z.string().max(max);

/** Target keys and field keys are short identifiers, never file content. */
const mapKey = z.string().min(1).max(MAX_NAME);

export const harnessIdSchema = z.enum(HARNESS_IDS);

export const extrasSchema = z.record(mapKey, optionalText(MAX_EXTRA_VALUE));

export const overridesSchema = z.record(mapKey, optionalText(MAX_OVERRIDE));

export const conflictPolicySchema = z.enum(['skip', 'overwrite']);

export const loginRequestSchema = z.object({
  password: optionalText(MAX_KEY),
});

export const createProfileRequestSchema = z.object({
  name: entityName,
  baseUrl: optionalText(MAX_URL).optional(),
  apiKey: optionalText(MAX_KEY).optional(),
  model: optionalText(MAX_NAME).optional(),
  notes: optionalText(MAX_NOTES).optional(),
  extras: extrasSchema.optional(),
  overrides: overridesSchema.optional(),
  providerId: optionalText(MAX_NAME).optional(),
  providerEndpoint: optionalText(MAX_NAME).optional(),
});

/** Every field is optional: a PATCH leaves anything it does not mention untouched. */
export const updateProfileRequestSchema = createProfileRequestSchema.partial();

export const providerEndpointRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'endpoint key 不能为空')
    .max(60, 'endpoint key 过长')
    .refine((value) => !value.includes('/') && !value.includes('\\'), 'endpoint key 不能包含斜杠'),
  /** Falls back to the key when absent, which is what the vault service does. */
  label: optionalText(MAX_NAME).optional(),
  baseUrl: z.string().trim().min(1, 'endpoint 需要 baseUrl').max(MAX_URL),
});

/** Endpoint keys are referenced by profiles, so a duplicate would be unresolvable. */
const endpointListSchema = z
  .array(providerEndpointRequestSchema)
  .max(50)
  .refine(
    (endpoints) => new Set(endpoints.map((endpoint) => endpoint.key)).size === endpoints.length,
    'endpoint key 不能重复',
  );

export const createProviderRequestSchema = z.object({
  name: entityName,
  apiKey: z.string().min(1, 'apiKey 不能为空').max(MAX_KEY),
  endpoints: endpointListSchema.optional(),
  notes: optionalText(MAX_NOTES).optional(),
});

export const updateProviderRequestSchema = z.object({
  name: entityName.optional(),
  /** Non-empty rotates the credential; empty or absent keeps the current one. */
  apiKey: optionalText(MAX_KEY).optional(),
  endpoints: endpointListSchema.optional(),
  notes: optionalText(MAX_NOTES).optional(),
});

export const userSyncRequestSchema = z.object({
  sourceUser: z.string().trim().min(1, '来源用户不能为空').max(MAX_NAME),
  conflictPolicy: conflictPolicySchema.optional(),
  overwriteHarnesses: z.array(harnessIdSchema).optional(),
  migrateCodexLoginCache: z.boolean().optional(),
});

export const transferEnvelopeSchema = z.object({
  format: z.literal('harness-switch-encrypted-export'),
  version: z.literal(1),
  kdf: z.object({
    name: z.literal('scrypt'),
    salt: z.string().min(1),
  }),
  cipher: z.object({
    name: z.literal('aes-256-gcm'),
    iv: z.string().min(1),
    tag: z.string().min(1),
    data: z.string().min(1),
  }),
});

export const transferExportRequestSchema = z.object({
  passphrase: optionalText(MAX_KEY),
  includeCodexLoginCache: z.boolean().optional(),
});

export const transferImportRequestSchema = z.object({
  envelope: transferEnvelopeSchema,
  passphrase: optionalText(MAX_KEY),
  conflictPolicy: conflictPolicySchema.optional(),
  restoreActive: z.boolean().optional(),
  migrateCodexLoginCache: z.boolean().optional(),
});

/**
 * One decision from the import wizard. The credential is deliberately absent: the
 * server re-reads it from the tool's own file, so a browser never has to hold it.
 */
export const scanImportSelectionSchema = z.object({
  /** Candidate id from the scan response. */
  id: z
    .string()
    .min(1)
    .max(MAX_NAME * 2),
  name: entityName,
  /** `profile` stores the credential inline; `vault` extracts it into a shared entry. */
  target: z.enum(['profile', 'vault']),
  /**
   * Only for candidates the scan found no credential for, such as a provider that reads
   * its key from the shell environment. Ignored when the file already holds one.
   */
  apiKey: optionalText(MAX_KEY).optional(),
  /** Reuse this vault entry instead of creating one. Only read when target is `vault`. */
  providerId: optionalText(MAX_NAME).optional(),
  /** Name for the vault entry to create. Defaults to the profile name. */
  providerName: entityName.optional(),
  /** Replace an existing profile of the same name instead of skipping it. */
  overwrite: z.boolean().optional(),
});

export const scanImportRequestSchema = z.object({
  selections: z.array(scanImportSelectionSchema).min(1, '请至少选择一条配置').max(200),
});

/**
 * Connectivity probe against an explicit base URL. The credential is either inline
 * (an unsaved form) or resolved server-side from the vault, so a draft key never has
 * to be saved before it can be tested.
 */
export const probeRequestSchema = z.object({
  baseUrl: z.string().trim().min(1, 'baseUrl 不能为空').max(MAX_URL),
  apiKey: optionalText(MAX_KEY).optional(),
  providerId: optionalText(MAX_NAME).optional(),
});

/** Probe with the credential and base URL already stored for an entity. */
export const probeStoredRequestSchema = z.object({
  /** Named vault endpoint to test; defaults to the entry's first endpoint. */
  endpoint: optionalText(MAX_NAME).optional(),
});

/** GitHub Sync schemas */
export const gitHubDeviceCodeRequestSchema = z.object({
  clientId: optionalText(100).optional(),
});

export const gitHubDevicePollRequestSchema = z.object({
  deviceCode: z.string().min(1).max(200),
  clientId: optionalText(100).optional(),
});

export const gitHubTokenAuthRequestSchema = z.object({
  token: z.string().trim().min(1, 'Token 不能为空').max(500),
});

export const gitHubPushRequestSchema = z.object({
  passphrase: optionalText(MAX_KEY),
  includeCodexLoginCache: z.boolean().optional(),
});

export const gitHubPullPreviewRequestSchema = z.object({
  passphrase: optionalText(MAX_KEY),
  conflictPolicy: conflictPolicySchema.optional(),
  restoreActive: z.boolean().optional(),
});

export const gitHubPullRequestSchema = z.object({
  passphrase: optionalText(MAX_KEY),
  conflictPolicy: conflictPolicySchema.optional(),
  restoreActive: z.boolean().optional(),
  migrateCodexLoginCache: z.boolean().optional(),
});

/** Neither drift action takes options yet, but both still reject a non-object body. */
export const emptyRequestSchema = z.object({});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ProviderEndpointRequest = z.infer<typeof providerEndpointRequestSchema>;
export type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>;
export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;
export type UserSyncRequest = z.infer<typeof userSyncRequestSchema>;
export type TransferExportRequest = z.infer<typeof transferExportRequestSchema>;
export type TransferImportRequest = z.infer<typeof transferImportRequestSchema>;
export type ScanImportSelection = z.infer<typeof scanImportSelectionSchema>;
export type ScanImportRequest = z.infer<typeof scanImportRequestSchema>;
export type ProbeRequest = z.infer<typeof probeRequestSchema>;
export type ProbeStoredRequest = z.infer<typeof probeStoredRequestSchema>;
export type GitHubDeviceCodeRequest = z.infer<typeof gitHubDeviceCodeRequestSchema>;
export type GitHubDevicePollRequest = z.infer<typeof gitHubDevicePollRequestSchema>;
export type GitHubTokenAuthRequestSchemaType = z.infer<typeof gitHubTokenAuthRequestSchema>;
export type GitHubPushRequestSchemaType = z.infer<typeof gitHubPushRequestSchema>;
export type GitHubPullPreviewRequestSchemaType = z.infer<typeof gitHubPullPreviewRequestSchema>;
export type GitHubPullRequestSchemaType = z.infer<typeof gitHubPullRequestSchema>;

/**
 * Flattens a failure into one line naming the offending fields, which is what both the
 * CLI and the toast in the web UI show.
 */
export function formatSchemaError(error: z.ZodError): string {
  const parts = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const suffix = error.issues.length > parts.length ? ` 等 ${error.issues.length} 处` : '';
  return `请求数据无效（${parts.join('；')}${suffix}）`;
}
