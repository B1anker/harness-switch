import type { ModelFavorite } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function IgnoreUpdates({ favorite }: { favorite: ModelFavorite }) {
  const { t } = useTranslation();
  const ignore = useAppStore((state) => state.ignoreFavoriteUpdates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void ignore(favorite)
            .catch((cause) => setError(lineText(t, errorLine(cause))))
            .finally(() => setBusy(false));
        }}
      >
        {t('favorites.onboarding.ignoreUpdates')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('favorites.onboarding.ignoreUpdatesHint')}</p>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
