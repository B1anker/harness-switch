import {
  type FavoriteConnection,
  type FavoriteInput,
  type ModelFacts,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';

export const NEW_TEMPLATE_FACTS: ModelFacts = {
  contextWindow: 262144,
  maxOutputTokens: 65536,
  reasoningSupported: true,
};

export type InferredFacts = Record<string, ModelFacts>;
const factKeys: Array<keyof ModelFacts> = [
  'contextWindow',
  'maxOutputTokens',
  'reasoningSupported',
  'supportedReasoningEfforts',
];

const equalValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Inferences belong to one connection and never replace a value the user authored. */
export function updateConnectionFacts(
  draft: FavoriteInput,
  id: string,
  patch: Partial<FavoriteConnection>,
  inferred: InferredFacts,
  hint?: ModelFacts,
) {
  const previous = draft.connections.find((connection) => connection.id === id);
  if (!previous) {
    return { draft, inferred };
  }
  const next = {
    ...previous,
    ...patch,
    factOverrides: { ...previous.factOverrides, ...patch.factOverrides },
  };
  const tracked = { ...inferred[id] };
  if (patch.factOverrides) {
    for (const key of factKeys) {
      if (!equalValue(previous.factOverrides[key], next.factOverrides[key])) {
        delete tracked[key];
      }
    }
  }
  const identityChanged = ['requestModelId', 'providerId', 'endpointKey'].some(
    (key) =>
      key in patch &&
      patch[key as keyof FavoriteConnection] !== previous[key as keyof FavoriteConnection],
  );
  if (identityChanged) {
    // Effort controls belong to this exact model route, including after reopening a saved template.
    delete next.factOverrides.supportedReasoningEfforts;
    next.preferenceOverrides = { ...next.preferenceOverrides, reasoningEffort: null };
    for (const key of factKeys) {
      if (tracked[key] !== undefined && equalValue(previous.factOverrides[key], tracked[key])) {
        delete next.factOverrides[key];
      }
      delete tracked[key];
      if (
        hint?.[key] !== undefined &&
        next.factOverrides[key] === undefined &&
        (key === 'supportedReasoningEfforts' ||
          draft.defaults[key] === undefined ||
          equalValue(draft.defaults[key], NEW_TEMPLATE_FACTS[key]))
      ) {
        Object.assign(next.factOverrides, { [key]: hint[key] });
        Object.assign(tracked, { [key]: hint[key] });
      }
    }
  }
  const resolved = resolveFavorite(draft, next);
  const levelsChanged =
    patch.factOverrides &&
    'supportedReasoningEfforts' in patch.factOverrides &&
    !equalValue(
      previous.factOverrides.supportedReasoningEfforts,
      next.factOverrides.supportedReasoningEfforts,
    );
  if (
    resolved.preferences.reasoningEffort &&
    !resolved.facts.supportedReasoningEfforts?.includes(resolved.preferences.reasoningEffort) &&
    (levelsChanged ||
      (identityChanged &&
        (resolved.facts.supportedReasoningEfforts || inferred[id]?.supportedReasoningEfforts)))
  ) {
    next.preferenceOverrides = { ...next.preferenceOverrides, reasoningEffort: null };
  }
  if (resolved.facts.reasoningSupported === false) {
    next.factOverrides.supportedReasoningEfforts = null;
    next.preferenceOverrides = { ...next.preferenceOverrides, reasoningEffort: null };
  }
  return {
    draft: {
      ...draft,
      connections: draft.connections.map((connection) =>
        connection.id === id ? next : connection,
      ),
    },
    inferred: { ...inferred, [id]: tracked },
  };
}

export function updateDefaultFacts(draft: FavoriteInput, facts: ModelFacts): FavoriteInput {
  const defaults = { ...facts };
  const preferences = { ...draft.preferences };
  if (defaults.reasoningSupported === false) {
    delete defaults.supportedReasoningEfforts;
    delete preferences.reasoningEffort;
  }
  if (
    preferences.reasoningEffort &&
    !defaults.supportedReasoningEfforts?.includes(preferences.reasoningEffort) &&
    !equalValue(draft.defaults.supportedReasoningEfforts, defaults.supportedReasoningEfforts)
  ) {
    delete preferences.reasoningEffort;
  }
  const next = { ...draft, defaults, preferences };
  return {
    ...next,
    connections: next.connections.map((connection) =>
      resolveFavorite(next, connection).facts.reasoningSupported === false
        ? {
            ...connection,
            factOverrides: { ...connection.factOverrides, supportedReasoningEfforts: null },
            preferenceOverrides: { ...connection.preferenceOverrides, reasoningEffort: null },
          }
        : connection,
    ),
  };
}
