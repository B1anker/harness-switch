import type { FavoritePlanRequest } from '@seaveyon/harness-switch-shared';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { IgnoreUpdates } from './ignore-updates';

export function FavoriteNextStep({
  favorite,
  onConfigure,
  onConnect,
  onApply,
}: {
  favorite: FavoriteListItem;
  onConfigure(): void;
  onConnect(): void;
  onApply(items: FavoritePlanRequest['items']): void;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const activeCount = favorite.references.filter((ref) => {
    const harness = harnesses.find((item) => item.id === ref.harness);
    return harness?.active && !harness.active.official && harness.active.name === ref.name;
  }).length;
  const updates: FavoritePlanRequest['items'] = favorite.references
    .filter((ref) => ref.needsUpdate)
    .flatMap((ref) => {
      const profile = harnesses
        .find((item) => item.id === ref.harness)
        ?.profiles.find((item) => item.name === ref.name);
      const connection = favorite.connections.find(
        (item) => item.id === profile?.modelFavorite?.connectionId,
      );
      return connection
        ? [
            {
              harness: ref.harness,
              connectionId: connection.id,
              profile: ref.name,
              existing: true,
              mode: 'save' as const,
              ignorePreference: false,
              overwriteDiverged: false,
            },
          ]
        : [];
    })
    .filter(
      (item, index, items) => items.findIndex((other) => other.harness === item.harness) === index,
    );
  const updateCount = favorite.references.filter((ref) => ref.needsUpdate).length;
  return (
    <div className="space-y-3 rounded-xl border bg-primary/5 p-4" role="status">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
        <span>{t('favorites.onboarding.savedCount', { count: favorite.references.length })}</span>
        <span>{t('favorites.onboarding.activeCount', { count: activeCount })}</span>
        {updateCount ? (
          <span>{t('favorites.onboarding.updateCount', { count: updateCount })}</span>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t(
          favorite.references.length
            ? 'favorites.onboarding.connectedHint'
            : 'favorites.onboarding.savedHint',
        )}
      </p>
      {!favorite.references.length ? (
        <Button
          variant="outline"
          className="h-auto max-w-full whitespace-normal py-2"
          onClick={favorite.connections.length ? onConfigure : onConnect}
        >
          {t(
            favorite.connections.length
              ? 'favorites.onboarding.configureNext'
              : 'favorites.onboarding.connectNext',
          )}
        </Button>
      ) : null}
      {updates.length ? (
        <Button
          variant="outline"
          className="h-auto max-w-full whitespace-normal py-2"
          onClick={() => onApply(updates)}
        >
          {t('favorites.onboarding.reviewUpdates', { count: updates.length })}
        </Button>
      ) : null}
      {updateCount ? <IgnoreUpdates favorite={favorite} /> : null}
    </div>
  );
}
