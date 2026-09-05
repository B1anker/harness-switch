import type {
  FavoritePlanRequest,
  HarnessSummary,
  ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useFavoriteTargets } from '@/lib/use-favorite-targets';
import { useAppStore } from '@/stores/app-store';
import { ConfigurationPath } from './configuration-path';

export function SwitchPanel({
  favorite,
  harness,
}: {
  favorite: ModelFavorite;
  harness: HarnessSummary;
}) {
  const { t } = useTranslation();
  const { targets, loading, error: targetError } = useFavoriteTargets(favorite);
  const makePlan = useAppStore((state) => state.planFavorite);
  const clear = useAppStore((state) => state.clearFavoritePlan);
  useEffect(() => () => clear(), [clear]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<FavoritePlanRequest['items'] | null>(null);
  const compatible = compatibleConnections(favorite, harness.id, targets);
  const selection = favoriteSelection(favorite, harness, targets, 'activate');
  const connectionId = chosen ?? selection.connectionId;
  const connection = compatible.find((entry) => entry.id === connectionId);
  const preview = async () => {
    if (!connection || busy) {
      return;
    }
    setBusy(true);
    setError('');
    const items = [{ ...selection, connectionId }];
    try {
      await makePlan({ favoriteId: favorite.id, expectedRevision: favorite.revision, items });
      setReview(items);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('workspace.checking')}
        </p>
      ) : null}
      {targetError ? <Alert>{targetError}</Alert> : null}
      {!loading && !targetError && !compatible.length ? (
        <Alert variant="warning">{t('favorites.noCompatibleChannel')}</Alert>
      ) : null}
      {compatible.length > 1 ? (
        <FavoriteSelect
          id="workspace-channel"
          label={t('favorites.connection')}
          placeholder={t('workspace.chooseChannel')}
          value={connectionId}
          options={compatible.map((entry) => ({
            value: entry.id,
            label: `${entry.label} · ${entry.requestModelId}`,
          }))}
          onChange={setChosen}
        />
      ) : null}
      {connection ? (
        <ConfigurationPath connection={connection} harness={harness.id} name={harness.label} />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5 text-sm">
        <span className="text-muted-foreground">
          {t('workspace.currentToolModel', { name: harness.label })}
        </span>
        <span className="max-w-full break-all font-mono">
          {harness.active?.model ||
            t(harness.active?.official ? 'harness.official' : 'harness.currentInactive')}
        </span>
        <ArrowRight className="size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">
          {t('workspace.targetToolModel', { name: harness.label })}
        </span>
        <span className="max-w-full break-all font-medium">
          {connection?.requestModelId ?? favorite.name}
        </span>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex max-w-sm items-center gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          {t('workspace.previewHint')}
        </p>
        <Button size="lg" disabled={busy || !connection} onClick={() => void preview()}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {t('workspace.preview')}
          <ArrowRight />
        </Button>
      </div>
      {review ? (
        <ModelFavoriteApplyDialog
          favorite={favorite}
          initialItems={review}
          initialMode="activate"
          initialPreview
          onClose={() => {
            clear();
            setReview(null);
          }}
        />
      ) : null}
    </div>
  );
}
