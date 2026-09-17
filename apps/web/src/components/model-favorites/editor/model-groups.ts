import {
  connectionProtocols,
  type FavoriteConnection,
  type FavoriteInput,
  syncConnectionProtocols,
} from '@seaveyon/harness-switch-shared';

export function modelGroups(connections: FavoriteConnection[]) {
  const groups = new Map<string, FavoriteConnection[]>();
  for (const connection of connections) {
    const key = connection.groupId ?? connection.id;
    const group = groups.get(key) ?? [];
    group.push(connection);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Protocol copies of the same account+models (cpa vs cpa · codex) are one account on the
 * relationship graph: the tool picks the protocol it can speak when applying.
 */
export function accountClusters(connections: FavoriteConnection[]) {
  const clusters = new Map<string, FavoriteConnection[]>();
  for (const group of modelGroups(connections)) {
    const first = group[0]!;
    const models = [...new Set(group.map((entry) => entry.requestModelId).filter(Boolean))]
      .slice()
      .sort();
    const key = `${first.providerId}\0${first.endpointKey}\0${models.join('\0')}`;
    const cluster = clusters.get(key) ?? [];
    cluster.push(...group);
    clusters.set(key, cluster);
  }
  return [...clusters.values()];
}

/**
 * Kimi/DSH accept every protocol, so Claude+Codex protocol copies of the same
 * account+model would otherwise land as two providers that differ only in type.
 * Keep one connection per provider/endpoint/model, preferring `preferredId`.
 */
export function collapseProtocolCopies(
  connections: FavoriteConnection[],
  preferredId?: string | null,
) {
  const chosen = new Map<string, FavoriteConnection>();
  for (const entry of connections) {
    if (!entry.requestModelId) {
      continue;
    }
    const key = `${entry.providerId}\0${entry.endpointKey}\0${entry.requestModelId}`;
    const current = chosen.get(key);
    if (!current || preferredId === entry.id) {
      chosen.set(key, entry);
    }
  }
  return [...chosen.values()];
}

/** Map a preferred connection id onto the surviving copy after {@link collapseProtocolCopies}. */
export function resolveCollapsedDefault(
  preferredId: string | undefined,
  candidates: FavoriteConnection[],
  all: FavoriteConnection[],
) {
  if (preferredId && candidates.some((entry) => entry.id === preferredId)) {
    return preferredId;
  }
  const source = preferredId ? all.find((entry) => entry.id === preferredId) : undefined;
  if (source?.requestModelId) {
    const sibling = candidates.find(
      (entry) =>
        entry.providerId === source.providerId &&
        entry.endpointKey === source.endpointKey &&
        entry.requestModelId === source.requestModelId,
    );
    if (sibling) {
      return sibling.id;
    }
  }
  return candidates.length === 1 ? candidates[0]!.id : '';
}

const TOOL_LABEL_SUFFIX = /\s·\s(?:claude|codex|kimi|dsh|pi)$/i;

/** Strip the " · codex" style suffix the protocol-copy button stamps on. */
export function accountLabel(cluster: FavoriteConnection[], fallback: string) {
  const bases = [
    ...new Set(
      cluster.map((entry) => entry.label.replace(TOOL_LABEL_SUFFIX, '').trim()).filter(Boolean),
    ),
  ]
    .slice()
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  return bases[0] || fallback;
}

export function selectGroupModels(
  draft: FavoriteInput,
  group: FavoriteConnection[],
  models: string[],
): FavoriteInput {
  const first = group[0]!;
  const groupId = first.groupId ?? first.id;
  const rows = (models.length ? models : ['']).map((requestModelId, index) => {
    const existing = group.find((item) => item.requestModelId === requestModelId);
    return existing
      ? { ...existing, groupId }
      : {
          ...first,
          id: !first.requestModelId && index === 0 ? first.id : crypto.randomUUID(),
          groupId,
          requestModelId,
          factOverrides: {},
          preferenceOverrides: {},
        };
  });
  const oldIds = new Set(group.map((item) => item.id));
  const connections = draft.connections.flatMap((item) =>
    item.id === first.id ? rows : oldIds.has(item.id) ? [] : [item],
  );
  return pruneFavoriteDraft({
    ...draft,
    connections,
    // Keep a removed default id so validation can ask for a replacement.
    defaultConnectionId: draft.defaultConnectionId,
  });
}

/**
 * Drop tool-binding pointers that no longer resolve after a connection (or protocol
 * copy) was removed — otherwise save fails with a vague "reselect models" error.
 * Stale `defaultConnectionId` is left alone so the editor can ask for a replacement.
 */
export function pruneFavoriteDraft(draft: FavoriteInput): FavoriteInput {
  const ids = new Set(draft.connections.map((entry) => entry.id));
  const groups = new Set(draft.connections.map((entry) => entry.groupId ?? entry.id));
  const defaultConnectionId =
    draft.defaultConnectionId === undefined
      ? draft.connections.find((entry) => entry.requestModelId)?.id
      : draft.defaultConnectionId;
  if (!draft.toolBindings) {
    return { ...draft, defaultConnectionId };
  }
  const toolBindings = Object.fromEntries(
    Object.entries(draft.toolBindings).flatMap(([tool, binding]) => {
      const connectionId =
        binding.connectionId && groups.has(binding.connectionId) ? binding.connectionId : undefined;
      const selected = connectionId
        ? draft.connections.filter((entry) => (entry.groupId ?? entry.id) === connectionId)
        : undefined;
      const inScope = (id: string | undefined) => {
        if (!id || !ids.has(id)) {
          return false;
        }
        if (!selected) {
          return true;
        }
        return selected.some((entry) => entry.id === id);
      };
      const modelIds = binding.modelIds?.filter(inScope);
      const tiers = binding.tiers
        ? {
            opus: inScope(binding.tiers.opus) ? binding.tiers.opus : undefined,
            sonnet: inScope(binding.tiers.sonnet) ? binding.tiers.sonnet : undefined,
            haiku: inScope(binding.tiers.haiku) ? binding.tiers.haiku : undefined,
          }
        : undefined;
      const tiersComplete = !!tiers?.opus && !!tiers.sonnet && !!tiers.haiku;
      const next = {
        ...binding,
        connectionId,
        defaultModelId: inScope(binding.defaultModelId) ? binding.defaultModelId : undefined,
        modelIds: modelIds?.length ? modelIds : undefined,
        mode: binding.mode === 'tiers' && !tiersComplete ? 'default' : binding.mode,
        tiers: binding.mode === 'tiers' && tiersComplete ? tiers : undefined,
      };
      if (
        !next.connectionId &&
        !next.defaultModelId &&
        !next.modelIds &&
        !next.tiers &&
        !next.reasoningEffort
      ) {
        return [];
      }
      return [[tool, next]];
    }),
  );
  return {
    ...draft,
    defaultConnectionId,
    toolBindings: Object.keys(toolBindings).length ? toolBindings : undefined,
  };
}

/**
 * Drop a connection group and fold its protocols into the same vault account's
 * remaining rows (cpa · codex → cpa), so linked tools keep a compatible channel.
 */
export function removeConnectionGroup(
  draft: FavoriteInput,
  group: FavoriteConnection[],
): FavoriteInput {
  const removed = new Set(group.map((entry) => entry.id));
  const first = group[0];
  const absorbed = first ? connectionProtocols(first) : [];
  const connections = draft.connections.flatMap((entry) => {
    if (removed.has(entry.id)) {
      return [];
    }
    if (
      first &&
      entry.providerId === first.providerId &&
      entry.endpointKey === first.endpointKey &&
      absorbed.length
    ) {
      return [
        {
          ...entry,
          ...syncConnectionProtocols([...connectionProtocols(entry), ...absorbed]),
        },
      ];
    }
    return [entry];
  });
  return pruneFavoriteDraft({
    ...draft,
    connections,
    defaultConnectionId: draft.defaultConnectionId,
  });
}
