import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';

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
    const models = [
      ...new Set(group.map((entry) => entry.requestModelId).filter(Boolean)),
    ].toSorted();
    const key = `${first.providerId}\0${first.endpointKey}\0${models.join('\0')}`;
    const cluster = clusters.get(key) ?? [];
    cluster.push(...group);
    clusters.set(key, cluster);
  }
  return [...clusters.values()];
}

const TOOL_LABEL_SUFFIX = /\s·\s(?:claude|codex|kimi|dsh|pi)$/i;

/** Strip the " · codex" style suffix the protocol-copy button stamps on. */
export function accountLabel(cluster: FavoriteConnection[], fallback: string) {
  const bases = [
    ...new Set(
      cluster.map((entry) => entry.label.replace(TOOL_LABEL_SUFFIX, '').trim()).filter(Boolean),
    ),
  ].toSorted((left, right) => left.length - right.length || left.localeCompare(right));
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
  return {
    ...draft,
    connections,
    toolBindings: draft.toolBindings
      ? Object.fromEntries(
          Object.entries(draft.toolBindings).map(([tool, binding]) => [
            tool,
            {
              ...binding,
              modelIds: binding.modelIds?.filter((id) =>
                connections.some((entry) => entry.id === id),
              ),
            },
          ]),
        )
      : undefined,
    defaultConnectionId:
      draft.defaultConnectionId ?? connections.find((item) => item.requestModelId)?.id,
  };
}
