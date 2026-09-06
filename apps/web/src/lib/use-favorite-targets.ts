import type { ModelFavorite } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function useFavoriteTargets(favorite: ModelFavorite) {
  const { t } = useTranslation();
  const load = useAppStore((state) => state.loadFavoriteTargets);
  const targets = useAppStore((state) => state.favoriteTargets[favorite.id]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void load(favorite.id)
      .catch((cause) => {
        if (active) {
          setError(lineText(t, errorLine(cause)));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [load, favorite.id, favorite.revision, t]);
  return { targets: loading || error ? undefined : targets, loading, error };
}
