import type {
  FavoritePlanRequest,
  HarnessSummary,
  ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import type { FavoriteSlice } from '@/stores/slices/model-favorites';

export function compatibleConnections(
  favorite: ModelFavorite,
  harness: string,
  targets: FavoriteSlice['favoriteTargets'][string] | undefined,
) {
  return favorite.connections.filter((connection) =>
    targets
      ?.find((target) => target.harness === harness)
      ?.connections.some(
        (entry) => entry.id === connection.id && !entry.projection.blockers.length,
      ),
  );
}

export function favoriteSelection(
  favorite: ModelFavorite,
  harness: HarnessSummary,
  targets: FavoriteSlice['favoriteTargets'][string] | undefined,
  mode: 'save' | 'activate',
): FavoritePlanRequest['items'][number] {
  const connections = compatibleConnections(favorite, harness.id, targets);
  const linked = harness.profiles.filter(
    (profile) => profile.modelFavorite?.favoriteId === favorite.id,
  );
  const current = linked.find(
    (profile) => !harness.active?.official && profile.name === harness.active?.name,
  );
  const existing = current ?? (linked.length === 1 ? linked[0] : undefined);
  const remembered = existing?.modelFavorite?.connectionId;
  return {
    harness: harness.id,
    connectionId: connections.some((connection) => connection.id === remembered)
      ? remembered!
      : connections.length === 1
        ? connections[0]!.id
        : '',
    existing: !!existing,
    profile: existing?.name,
    mode,
    ignorePreference: false,
    overwriteDiverged: false,
  };
}
