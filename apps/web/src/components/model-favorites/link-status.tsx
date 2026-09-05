import type { ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function FavoriteLinkStatus({ profile }: { profile: ProfilePublic }) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const load = useAppStore((state) => state.loadFavorites);
  const detach = useAppStore((state) => state.detachFavorite);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      <p>
        {t('favorites.linked')}:{' '}
        {favorite?.name ??
          (favorites ? t('favorites.sourceMissing') : profile.modelFavorite?.favoriteId)}
      </p>
      {reference?.connectionMissing ? <p>{t('favorites.connectionMissing')}</p> : null}
      {reference?.needsUpdate ? <p>{t('favorites.needsUpdate')}</p> : null}
      {reference?.diverged ? <p>{t('favorites.diverged')}</p> : null}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await detach(profile.harness, profile.name);
          } catch (cause) {
            setError(lineText(t, errorLine(cause)));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('favorites.detach')}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
