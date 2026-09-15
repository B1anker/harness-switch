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
