import { z } from 'zod';
import { VALIDATION_CODES } from './errors';
import { HARNESS_IDS } from './harnesses';
import { modelFavoriteLinkSchema, modelFavoriteSchema } from './model-favorites';

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
const MAX_ENDPOINT_KEY = 60;
const MAX_URL = 2048;
const MAX_NOTES = 4096;
const MAX_KEY = 4096;
const MAX_EXTRA_VALUE = 4096;
/** An override is a whole config file the user took over, so it needs real headroom. */
const MAX_OVERRIDE = 1024 * 1024;
/** The shortest password a rotation will accept; the server enforces the same floor. */
const MIN_PASSWORD = 10;

/**
 * The same limits, for the forms that collect these values.
 *
 * A field that lets the user type past the limit only to have the request rejected
 * wastes the work they just did, so the input caps itself where the schema would.
 */
export const LIMITS = {
  name: MAX_NAME,
  endpointKey: MAX_ENDPOINT_KEY,
  url: MAX_URL,
  notes: MAX_NOTES,
  apiKey: MAX_KEY,
  minPassword: MIN_PASSWORD,
} as const;

/** Names become object keys in the store and slugs in backup directory names. */
const entityName = z
  .string()
  .trim()
  .min(1, VALIDATION_CODES.nameRequired)
  .max(MAX_NAME, VALIDATION_CODES.nameTooLong)
  .refine((value) => !value.includes('/') && !value.includes('\\'), VALIDATION_CODES.nameSlash);

const optionalText = (max: number) => z.string().max(max);

/** Target keys and field keys are short identifiers, never file content. */
const mapKey = z.string().min(1).max(MAX_NAME);

export const harnessIdSchema = z.enum(HARNESS_IDS);

export const extrasSchema = z.record(mapKey, optionalText(65536)).superRefine((extras, context) => {
  for (const [key, value] of Object.entries(extras)) {
    if (key !== 'modelCatalog' && value.length > MAX_EXTRA_VALUE) {
      context.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum: MAX_EXTRA_VALUE,
        inclusive: true,
        path: [key],
      });
    }
  }
});

export const overridesSchema = z.record(mapKey, optionalText(MAX_OVERRIDE));

export const conflictPolicySchema = z.enum(['skip', 'overwrite']);

/**
 * Wire protocols a minimal completion can be sent over. These are the three shapes the
 * managed harnesses speak, so an adapter's own protocol field maps onto one of them and
 * the probe tests the endpoint the same way the tool will actually call it.
 */
export const completionProtocolSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
]);

export const loginRequestSchema = z.object({
  password: z.string().trim().min(1, VALIDATION_CODES.passwordRequired).max(MAX_KEY),
});

/**
 * A password rotation. The current password is required even though the caller already
 * holds a session: a borrowed cookie must not be enough to lock the real owner out.
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, VALIDATION_CODES.passwordRequired).max(MAX_KEY),
  newPassword: z.string().min(1, VALIDATION_CODES.passwordRequired).max(MAX_KEY),
});

export const createProfileRequestSchema = z.object({
  name: entityName,
  /** Existing profile to copy server-side, including its protected credential. */
  copySourceName: entityName.optional(),
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
    .min(1, VALIDATION_CODES.endpointKeyRequired)
    .max(MAX_ENDPOINT_KEY, VALIDATION_CODES.endpointKeyTooLong)
    .refine(
      (value) => !value.includes('/') && !value.includes('\\'),
      VALIDATION_CODES.endpointKeySlash,
    ),
  /** Falls back to the key when absent, which is what the vault service does. */
  label: optionalText(MAX_NAME).optional(),
  baseUrl: z.string().trim().min(1, VALIDATION_CODES.endpointBaseUrlRequired).max(MAX_URL),
});

/** Endpoint keys are referenced by profiles, so a duplicate would be unresolvable. */
const endpointListSchema = z
  .array(providerEndpointRequestSchema)
  .max(50)
  .refine(
    (endpoints) => new Set(endpoints.map((endpoint) => endpoint.key)).size === endpoints.length,
    VALIDATION_CODES.endpointKeyDuplicate,
  );

export const createProviderRequestSchema = z.object({
  name: entityName,
  apiKey: z.string().min(1, VALIDATION_CODES.apiKeyRequired).max(MAX_KEY),
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
  sourceUser: z.string().trim().min(1, VALIDATION_CODES.sourceUserRequired).max(MAX_NAME),
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

/**
 * The export payload, as it looks once the passphrase envelope is open.
 *
 * Not a request body, but validated exactly like one: it is written straight into the
 * profile store and the vault, and the envelope only proves the passphrase matched —
 * whoever knew it still could have shaped the plaintext however they liked. Unknown
 * keys are stripped here too, so nothing unrecognised reaches disk.
 */
const portableProfileSchema = z.object({
  modelFavorite: modelFavoriteLinkSchema.optional(),
  harness: harnessIdSchema,
  name: entityName,
  baseUrl: optionalText(MAX_URL),
  apiKey: optionalText(MAX_KEY),
  model: optionalText(MAX_NAME),
  notes: optionalText(MAX_NOTES),
  extras: extrasSchema,
  overrides: overridesSchema,
  providerId: optionalText(MAX_NAME).optional(),
  providerEndpoint: optionalText(MAX_NAME).optional(),
});

/** Ids become object keys in the vault store, so a prototype name would poison it. */
const portableProviderId = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => !value.includes('/') && !value.includes('\\'),
    VALIDATION_CODES.providerIdSlash,
  )
  .refine(
    (value) => value !== '__proto__' && value !== 'constructor',
    VALIDATION_CODES.providerIdReserved,
  );

const portableProviderSchema = z.object({
  id: portableProviderId,
  name: z.string().min(1).max(MAX_NAME),
  apiKey: z.string().min(1).max(MAX_KEY),
  notes: optionalText(MAX_NOTES).optional(),
  endpoints: z.array(
    z.object({
      key: mapKey,
      label: optionalText(MAX_NAME),
      baseUrl: optionalText(MAX_URL),
    }),
  ),
});

const portableActiveSchema = z.object({
  harness: harnessIdSchema,
  name: entityName,
  official: z.boolean(),
});

/** A malformed export must fail fast rather than stream unbounded work into the store. */
const MAX_PORTABLE_ITEMS = 10_000;

export const portablePayloadSchema = z.object({
  format: z.literal('harness-switch-portable-config'),
  version: z.union([z.literal(1), z.literal(2)]),
  favorites: z.array(modelFavoriteSchema).max(1000).optional(),
  exportedAt: z.string(),
  profiles: z.array(portableProfileSchema).max(MAX_PORTABLE_ITEMS),
  /** Optional so exports made before vault support remain importable. */
  providers: z.array(portableProviderSchema).max(MAX_PORTABLE_ITEMS).optional(),
  active: z.array(portableActiveSchema),
  /** Present only when the user explicitly included the native Codex login session. */
  codexLoginCache: z.string().optional(),
});

export const transferExportRequestSchema = z.object({
  legacy: z.boolean().optional(),
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
  selections: z
    .array(scanImportSelectionSchema)
    .min(1, VALIDATION_CODES.selectionRequired)
    .max(200),
});

/**
 * Connectivity probe against an explicit base URL. The credential is either inline
 * (an unsaved form) or resolved server-side from the vault, so a draft key never has
 * to be saved before it can be tested.
 */
export const probeRequestSchema = z.object({
  baseUrl: z.string().trim().min(1, VALIDATION_CODES.baseUrlRequired).max(MAX_URL),
  apiKey: optionalText(MAX_KEY).optional(),
  providerId: optionalText(MAX_NAME).optional(),
  /** Also send one minimal completion, which is the only proof a model really answers. */
  completion: z.boolean().optional(),
  /** Model to complete against. Falls back to the first id the catalog returned. */
  model: optionalText(MAX_NAME).optional(),
  /** Wire protocol to try first; the others are still attempted as fallbacks. */
  protocol: completionProtocolSchema.optional(),
});

/** Probe with the credential and base URL already stored for an entity. */
export const probeStoredRequestSchema = z.object({
  /** Named vault endpoint to test; defaults to the entry's first endpoint. */
  endpoint: optionalText(MAX_NAME).optional(),
  completion: z.boolean().optional(),
  model: optionalText(MAX_NAME).optional(),
  protocol: completionProtocolSchema.optional(),
  /** Ignore a cached completion outcome and send a fresh request. */
  refresh: z.boolean().optional(),
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
  token: z.string().trim().min(1, VALIDATION_CODES.tokenRequired).max(500),
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

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
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
export type CompletionProtocol = z.infer<typeof completionProtocolSchema>;
export type GitHubDeviceCodeRequest = z.infer<typeof gitHubDeviceCodeRequestSchema>;
export type GitHubDevicePollRequest = z.infer<typeof gitHubDevicePollRequestSchema>;
export type GitHubTokenAuthRequestSchemaType = z.infer<typeof gitHubTokenAuthRequestSchema>;
export type GitHubPushRequestSchemaType = z.infer<typeof gitHubPushRequestSchema>;
export type GitHubPullPreviewRequestSchemaType = z.infer<typeof gitHubPullPreviewRequestSchema>;
export type GitHubPullRequestSchemaType = z.infer<typeof gitHubPullRequestSchema>;

/** One rejected field: where it was and which catalog code says why. */
export type SchemaIssue = {
  /** Dotted path to the field, empty for a whole-body failure. */
  path: string;
  /** A `VALIDATION_CODES` entry when the schema set one, else Zod's own prose. */
  code: string;
};

/**
 * The offending fields, as codes rather than prose.
 *
 * Both clients render this, so the reason has to survive translation. Zod's built-in
 * messages (a type mismatch, an unparsable literal) have no code of their own and pass
 * through as-is: they name a shape the UI never offers, so they only ever reach a
 * developer holding a hand-written request.
 */
export function schemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.message,
  }));
}

/** The dotted field paths of a failure, for the `fields` interpolation. */
export function schemaFields(error: z.ZodError): string {
  return schemaIssues(error)
    .map((issue) => issue.path)
    .filter(Boolean)
    .join(', ');
}
