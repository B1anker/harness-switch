import type { FavoritePlanRequest, HarnessSummary } from '@seaveyon/harness-switch-shared';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';

/** One apply item per harness that still needs this template's update. */
export function favoriteUpdateItems(
  favorite: FavoriteListItem,
  harnesses: HarnessSummary[],
): FavoritePlanRequest['items'] {
  return favorite.references
    .filter((ref) => ref.needsUpdate)
    .flatMap((ref) => {
      const harness = harnesses.find((item) => item.id === ref.harness);
      const profile = harness?.profiles.find((item) => item.name === ref.name);
      const connection = favorite.connections.find(
        (item) => item.id === profile?.modelFavorite?.connectionId,
      );
      if (!connection) {
        return [];
      }
      return [
        {
          harness: ref.harness,
          connectionId: connection.id,
          profile: ref.name,
          existing: true,
          mode: 'activate' as const,
          ignorePreference: false,
          overwriteDiverged: false,
        },
      ];
    })
    .filter(
      (item, index, items) => items.findIndex((other) => other.harness === item.harness) === index,
    );
}
