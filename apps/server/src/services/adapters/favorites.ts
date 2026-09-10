import {
  ERROR_CODES,
  type FavoriteConnection,
  type FavoriteInput,
  type FavoriteProjection,
  type FavoriteProjectionResult,
  favoriteEffortSchema,
  type HarnessId,
  mapReasoningEffort,
  modelFactsSchema,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { AdapterProfile, HarnessAdapter } from './types';

const PROTOCOLS = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const;
export const FAVORITE_SUPPORT = {
  claude: ['anthropic-messages'],
  codex: ['openai-responses'],
  kimi: PROTOCOLS,
  pi: PROTOCOLS,
  dsh: PROTOCOLS,
} satisfies Record<HarnessId, readonly string[]>;

export function projectFavorite(
  adapter: Pick<HarnessAdapter, 'id' | 'fields'>,
  favorite: FavoriteInput,
  connection: FavoriteConnection,
  previous?: FavoriteProjection,
): FavoriteProjectionResult {
  const { id } = adapter;
  const resolved = resolveFavorite(favorite, connection);
  const { facts, preferences } = resolved;
  const binding = favorite.toolBindings?.[id];
  if (binding?.reasoningEffort) {
    preferences.reasoningEffort = binding.reasoningEffort;
  }
  const extras: FavoriteProjection['extras'] = {};
  const represented = new Set<string>();
  const put = (key: keyof FavoriteProjection['extras'], field: keyof typeof facts) => {
    const value = facts[field];
    if (value !== undefined) {
      extras[key] = String(value);
    } else if (previous?.extras[key] !== undefined) {
      extras[key] = null;
    }
    represented.add(field);
  };
  const result: FavoriteProjectionResult = {
    projectionVersion: 1,
    projection: {
      harness: id,
      model: connection.requestModelId,
      providerId: connection.providerId,
      providerEndpoint: connection.endpointKey,
      extras,
    },
    ownedFields: ['model', 'providerId', 'providerEndpoint'],
    set: {},
    remove: [],
    notRepresented: [],
    rendererDefaults: {},
    warnings: [],
    blockers: [],
  };
  if (!(FAVORITE_SUPPORT[id] as readonly string[]).includes(connection.protocol)) {
    result.blockers.push({ code: ERROR_CODES.favoriteProtocolUnsupported });
  }
  if (
    (id === 'claude' || id === 'codex') &&
    binding?.connectionId &&
    binding.connectionId !== (connection.groupId ?? connection.id)
  ) {
    result.blockers.push({ code: ERROR_CODES.favoriteProjectionUnsupported });
  }
  if (id === 'kimi') {
    extras.providerType = {
      'openai-chat': 'openai_legacy',
      'openai-responses': 'openai_responses',
      'anthropic-messages': 'anthropic',
    }[connection.protocol];
    put('maxContextSize', 'contextWindow');
  }
  if (id === 'pi' || id === 'dsh') {
    extras.api = connection.protocol === 'openai-chat' ? 'openai-completions' : connection.protocol;
    put('contextWindow', 'contextWindow');
    put('maxTokens', 'maxOutputTokens');
    if (id === 'pi') {
      put('reasoning', 'reasoningSupported');
    } else {
      extras.providerType = 'custom';
      if (facts.reasoningSupported === false) {
        extras.reasoningEfforts = 'false';
      } else if (facts.supportedReasoningEfforts?.length) {
        extras.reasoningEfforts = facts.supportedReasoningEfforts.join(',');
      } else if (previous?.extras.reasoningEfforts !== undefined) {
        extras.reasoningEfforts = null;
      }
      represented.add('supportedReasoningEfforts');
      if (facts.reasoningSupported === false || facts.supportedReasoningEfforts?.length) {
        represented.add('reasoningSupported');
      }
    }
  }
  // The canonical preference lands through the per-harness mapping table: claude writes
  // `effortLevel`, codex `model_reasoning_effort`, dsh `agent-default-model.reasoningEffort`.
  // kimi and pi expose no config-file effort key, so the preference stays not represented.
  const effort = preferences.reasoningEffort;
  const effortKey = id === 'claude' ? 'effortLevel' : 'reasoningEffort';
  const effortWritable = id === 'claude' || id === 'codex' || id === 'dsh';
  if (effort && effortWritable) {
    const mapped = mapReasoningEffort(id, effort, facts.supportedReasoningEfforts);
    if (mapped.native) {
      extras[effortKey] = mapped.native;
      if (mapped.clamped) {
        result.warnings.push({
          code: ERROR_CODES.favoriteEffortMapped,
          data: { from: effort, to: mapped.native },
        });
      }
    } else {
      if (previous?.extras[effortKey] !== undefined) {
        extras[effortKey] = null;
      }
      result.warnings.push({ code: ERROR_CODES.favoriteEffortUnset, data: { from: effort } });
    }
  } else if (effort) {
    result.notRepresented.push('reasoningEffort');
    result.warnings.push({ code: ERROR_CODES.favoritePreferenceNotRepresented });
  } else if (effortWritable && previous?.extras[effortKey] !== undefined) {
    extras[effortKey] = null;
  }
  if (preferences.reasoningEffort && facts.supportedReasoningEfforts === undefined) {
    result.warnings.push({ code: ERROR_CODES.favoriteEffortUnverified });
  }
  for (const field of Object.keys(facts)) {
    if (!represented.has(field)) {
      result.notRepresented.push(field);
    }
  }
  if (id === 'claude' && (binding || favorite.defaultConnectionId)) {
    for (const tier of ['opus', 'sonnet', 'haiku'] as const) {
      const modelId = binding?.mode === 'tiers' ? binding.tiers?.[tier] : connection.id;
      const model = favorite.connections.find((entry) => entry.id === modelId);
      if (!model || (model.groupId ?? model.id) !== (connection.groupId ?? connection.id)) {
        result.blockers.push({ code: ERROR_CODES.favoriteProjectionUnsupported });
      } else {
        extras[`${tier}Model`] = model.requestModelId;
      }
    }
  }
  if (id === 'codex' && (binding || favorite.defaultConnectionId)) {
    const models = favorite.connections.filter(
      (entry) =>
        (entry.groupId ?? entry.id) === (connection.groupId ?? connection.id) &&
        (!binding?.modelIds || binding.modelIds.includes(entry.id)),
    );
    if (!models.some((entry) => entry.id === connection.id)) {
      result.blockers.push({ code: ERROR_CODES.favoriteProjectionUnsupported });
    }
    extras.modelCatalog = JSON.stringify(
      models.map((entry) => {
        const resolvedModel = resolveFavorite(favorite, entry);
        return {
          model: entry.requestModelId,
          facts: resolvedModel.facts,
          preferences: resolvedModel.preferences,
        };
      }),
    );
  } else if (previous?.extras.modelCatalog) {
    extras.modelCatalog = null;
  }
  for (const field of adapter.fields) {
    if (
      ['contextWindow', 'maxContextSize', 'maxTokens', 'reasoning'].includes(field.key) &&
      extras[field.key as keyof typeof extras] == null &&
      field.defaultValue
    ) {
      result.rendererDefaults[field.key] = field.defaultValue;
    }
  }
  result.set = {
    model: connection.requestModelId,
    providerId: connection.providerId,
    providerEndpoint: connection.endpointKey,
  };
  for (const [key, value] of Object.entries(extras)) {
    result.ownedFields.push(`extras.${key}`);
    if (value === null) {
      result.remove.push(`extras.${key}`);
    } else {
      result.set[`extras.${key}`] = value;
    }
  }
  return result;
}

export function extractFavorite(
  adapter: Pick<HarnessAdapter, 'id' | 'completionProtocol'>,
  profile: AdapterProfile,
): Pick<FavoriteInput, 'defaults' | 'preferences'> & {
  protocol: FavoriteConnection['protocol'];
  requestModelId: string;
} {
  const { id } = adapter;
  const protocol = adapter.completionProtocol?.(profile);
  if (
    !profile.model ||
    !protocol ||
    !(FAVORITE_SUPPORT[id] as readonly string[]).includes(protocol) ||
    (id === 'dsh' && profile.extras.providerType === 'official') ||
    (id === 'kimi' && (!profile.extras.providerType || profile.extras.providerType === 'kimi')) ||
    (id === 'claude' && /\[[^\]]+\]/.test(profile.model))
  ) {
    throw new HttpError(409, ERROR_CODES.favoriteProjectionUnsupported, {
      code: ERROR_CODES.favoriteProjectionUnsupported,
    });
  }
  const facts: Record<string, unknown> = {};
  const numeric = (field: string, key: string) => {
    if (profile.extras[key]) {
      facts[field] = Number(profile.extras[key]);
    }
  };
  if (id === 'pi' || id === 'dsh') {
    numeric('contextWindow', 'contextWindow');
    numeric('maxOutputTokens', 'maxTokens');
    if (id === 'pi' && profile.extras.reasoning) {
      if (!['true', 'false'].includes(profile.extras.reasoning)) {
        throw new HttpError(409, ERROR_CODES.favoriteProjectionUnsupported, {
          code: ERROR_CODES.favoriteProjectionUnsupported,
        });
      }
      facts.reasoningSupported = profile.extras.reasoning === 'true';
    }
    if (id === 'dsh' && profile.extras.reasoningEfforts) {
      if (profile.extras.reasoningEfforts === 'false') {
        facts.reasoningSupported = false;
      } else {
        facts.supportedReasoningEfforts = profile.extras.reasoningEfforts
          .split(',')
          .map((effort) => effort.trim());
      }
    }
  }
  if (id === 'kimi') {
    numeric('contextWindow', 'maxContextSize');
  }
  const parsed = modelFactsSchema.safeParse(facts);
  const effort = favoriteEffortSchema
    .optional()
    .safeParse(id === 'codex' ? profile.extras.reasoningEffort || undefined : undefined);
  if (!parsed.success || !effort.success) {
    throw new HttpError(409, ERROR_CODES.favoriteProjectionUnsupported, {
      code: ERROR_CODES.favoriteProjectionUnsupported,
    });
  }
  return {
    defaults: parsed.data,
    preferences: effort.data ? { reasoningEffort: effort.data } : {},
    protocol,
    requestModelId: profile.model,
  };
}
