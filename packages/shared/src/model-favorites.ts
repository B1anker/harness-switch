import { z } from 'zod';
import { HARNESS_IDS } from './harnesses';

export const favoriteProtocolSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
]);
export const favoriteEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);
const capacity = z.number().int().positive().max(100_000_000);
const efforts = z
  .array(favoriteEffortSchema)
  .max(8)
  .refine((values) => new Set(values).size === values.length);
export const modelFactsSchema = z.object({
  contextWindow: capacity.optional(),
  maxOutputTokens: capacity.optional(),
  reasoningSupported: z.boolean().optional(),
  supportedReasoningEfforts: efforts.optional(),
});
const preferencesSchema = z.object({ reasoningEffort: favoriteEffortSchema.optional() });
export const favoriteConnectionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  providerId: z.string().min(1).max(120),
  endpointKey: z.string().min(1).max(60),
  protocol: favoriteProtocolSchema,
  requestModelId: z.string().trim().min(1).max(120),
  factOverrides: z
    .object({
      contextWindow: capacity.nullable().optional(),
      maxOutputTokens: capacity.nullable().optional(),
      reasoningSupported: z.boolean().nullable().optional(),
      supportedReasoningEfforts: efforts.nullable().optional(),
    })
    .default({}),
  preferenceOverrides: z
    .object({ reasoningEffort: favoriteEffortSchema.nullable().optional() })
    .default({}),
});
const favoriteFields = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(4096).default(''),
  defaults: modelFactsSchema.default({}),
  preferences: preferencesSchema.default({}),
  connections: z.array(favoriteConnectionSchema).max(50).default([]),
});
export type ModelFacts = z.infer<typeof modelFactsSchema>;
export type FavoriteConnection = z.infer<typeof favoriteConnectionSchema>;
export type FavoriteInput = z.infer<typeof favoriteFields>;
export type ResolvedFavorite = {
  facts: ModelFacts;
  preferences: z.infer<typeof preferencesSchema>;
  sources: Record<string, 'favorite' | 'connection' | 'unknown'>;
};

export function resolveFavorite(
  favorite: Pick<FavoriteInput, 'defaults' | 'preferences'>,
  connection: FavoriteConnection,
): ResolvedFavorite {
  const facts = { ...favorite.defaults };
  const sources: ResolvedFavorite['sources'] = {};
  for (const field of Object.keys(modelFactsSchema.shape) as Array<keyof ModelFacts>) {
    const override = connection.factOverrides[field];
    if (override === null) {
      delete facts[field];
    } else if (override !== undefined) {
      Object.assign(facts, { [field]: override });
    }
    sources[field] =
      override === null
        ? 'unknown'
        : override !== undefined
          ? 'connection'
          : facts[field] !== undefined
            ? 'favorite'
            : 'unknown';
  }
  const effort = connection.preferenceOverrides.reasoningEffort;
  const preferences =
    effort === null
      ? {}
      : effort === undefined
        ? { ...favorite.preferences }
        : { reasoningEffort: effort };
  sources.reasoningEffort =
    effort === null
      ? 'unknown'
      : effort !== undefined
        ? 'connection'
        : preferences.reasoningEffort
          ? 'favorite'
          : 'unknown';
  return { facts, preferences, sources };
}

function validateFavorite(value: FavoriteInput, ctx: z.RefinementCtx): void {
  const identities = new Set<string>();
  const ids = new Set<string>();
  const check = (
    facts: ModelFacts,
    preferences: ResolvedFavorite['preferences'],
    path: (string | number)[],
  ) => {
    const effort = preferences.reasoningEffort;
    if (
      (facts.reasoningSupported === false &&
        ((facts.supportedReasoningEfforts?.length ?? 0) > 0 || (effort && effort !== 'none'))) ||
      (effort &&
        facts.supportedReasoningEfforts &&
        !facts.supportedReasoningEfforts.includes(effort))
    ) {
      ctx.addIssue({ code: 'custom', path, message: 'favoriteInvalidFacts' });
    }
  };
  check(value.defaults, value.preferences, ['defaults']);
  value.connections.forEach((connection, index) => {
    const identity = JSON.stringify([
      connection.providerId,
      connection.endpointKey,
      connection.protocol,
      connection.requestModelId,
    ]);
    if (identities.has(identity) || ids.has(connection.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index],
        message: 'favoriteDuplicateConnection',
      });
    }
    identities.add(identity);
    ids.add(connection.id);
    const resolved = resolveFavorite(value, connection);
    check(resolved.facts, resolved.preferences, ['connections', index]);
  });
}
export const createFavoriteRequestSchema = favoriteFields.superRefine(validateFavorite);
export const modelFavoriteSchema = favoriteFields
  .extend({
    id: z.uuid(),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(validateFavorite);
export type ModelFavorite = z.infer<typeof modelFavoriteSchema>;
export const favoriteStoreSchema = z
  .object({ schemaVersion: z.literal(1), favorites: z.array(modelFavoriteSchema).max(1000) })
  .refine(
    (value) =>
      new Set(value.favorites.map((favorite) => favorite.id)).size === value.favorites.length,
  );
export const updateFavoriteRequestSchema = z.object({
  name: favoriteFields.shape.name.optional(),
  notes: z.string().max(4096).optional(),
  defaults: modelFactsSchema.optional(),
  preferences: preferencesSchema.optional(),
  connections: z.array(favoriteConnectionSchema).max(50).optional(),
  expectedRevision: z.number().int().positive().optional(),
});
export const favoriteRevisionRequestSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
});
export type UpdateFavoriteRequest = z.infer<typeof updateFavoriteRequestSchema>;
const ownedExtraSchema = z.enum([
  'api',
  'providerType',
  'contextWindow',
  'maxContextSize',
  'maxTokens',
  'reasoning',
  'reasoningEfforts',
  'reasoningEffort',
]);
export const favoriteProjectionSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: z.string().max(120),
  providerId: z.string().max(120),
  providerEndpoint: z.string().max(60),
  extras: z.partialRecord(ownedExtraSchema, z.string().max(4096).nullable()),
});
export type FavoriteProjection = z.infer<typeof favoriteProjectionSchema>;
export const modelFavoriteLinkSchema = z.object({
  favoriteId: z.uuid(),
  connectionId: z.uuid(),
  appliedRevision: z.number().int().positive(),
  projectionVersion: z.number().int().positive(),
  baseline: favoriteProjectionSchema,
});
export type ModelFavoriteLink = z.infer<typeof modelFavoriteLinkSchema>;
export type FavoriteProjectionResult = {
  projectionVersion: number;
  projection: FavoriteProjection;
  ownedFields: string[];
  set: Record<string, string>;
  remove: string[];
  notRepresented: string[];
  rendererDefaults: Record<string, string>;
  warnings: Array<{ code: string; data?: Record<string, string> }>;
  blockers: Array<{ code: string }>;
};

export const favoriteCaptureRequestSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  name: z.string().min(1).max(120),
  sourceFingerprint: z.string().length(64),
  favoriteName: z.string().trim().min(1).max(120),
  extractCredential: z.boolean().optional(),
  linkSource: z.boolean().optional(),
});
export const favoriteDetachRequestSchema = z.object({ sourceFingerprint: z.string().length(64) });
export const favoritePlanRequestSchema = z.object({
  favoriteId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  items: z
    .array(
      z.object({
        harness: z.enum(HARNESS_IDS),
        connectionId: z.uuid(),
        profile: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine((name) => !/[\\/]/.test(name))
          .optional(),
        existing: z.boolean().default(false),
        mode: z.enum(['save', 'activate']).default('save'),
        overwriteDiverged: z.boolean().default(false),
        allowAuthOverwrite: z.boolean().optional(),
        ignorePreference: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(5)
    .refine((items) => new Set(items.map((item) => item.harness)).size === items.length),
});
export const favoriteApplyRequestSchema = z.object({ requestId: z.uuid() });
export type FavoritePlanRequest = z.infer<typeof favoritePlanRequestSchema>;
export type FavoritePlanItem = FavoritePlanRequest['items'][number] & {
  preservedFields: string[];
  liveState: string;
  authMode: string;
  profile: string;
  projection: FavoriteProjectionResult;
  resolved: ResolvedFavorite;
  diff: Array<{ field: string; before: string | null; after: string | null }>;
  nativeFiles: Array<{
    key: string;
    changed: boolean;
    before: string | null;
    after: string | null;
  }>;
};
export type FavoritePlan = {
  id: string;
  expiresAt: string;
  favoriteRevision: number;
  items: FavoritePlanItem[];
};
export type FavoriteItemResult = {
  harness: (typeof HARNESS_IDS)[number];
  profile: string;
  status: 'applied' | 'unchanged' | 'failed' | 'skipped';
  operationId?: string;
  code?: string;
};
export type FavoriteOperation = { requestId: string; items: FavoriteItemResult[] };
