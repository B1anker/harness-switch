import type { ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';

export function FavoriteLinkStatus({
  profile,
  onOpenTemplate,
}: {
  profile: ProfilePublic;
  onOpenTemplate?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const load = useAppStore((state) => state.loadFavorites);
  useEffect(() => {
    if (favorites === null) {
      void load();
    }
  }, [favorites, load]);
  const favorite = favorites?.find((item) => item.id === profile.modelFavorite?.favoriteId);
  const reference = favorite?.references.find(
    (item) => item.harness === profile.harness && item.name === profile.name,
  );
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {' '}
        {favorite && onOpenTemplate ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 rounded-full px-2 text-xs"
            onClick={() => onOpenTemplate(favorite.id)}
          >
            {t('templates.tag')}
          </Button>
        ) : null}
        <span>
          {t('favorites.linked')}:{' '}
          {favorite?.name ??
            (favorites ? t('favorites.sourceMissing') : profile.modelFavorite?.favoriteId)}
        </span>
      </div>
      {reference?.connectionMissing ? <p>{t('favorites.connectionMissing')}</p> : null}
      {reference?.needsUpdate ? <p>{t('favorites.needsUpdate')}</p> : null}
      {reference?.diverged ? <p>{t('favorites.diverged')}</p> : null}
    </div>
  );
}
