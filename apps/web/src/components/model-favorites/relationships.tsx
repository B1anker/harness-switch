import type { FavoritePlanRequest, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { ArrowRight, Box, Network } from 'lucide-react';
import { useState } from 'react';
import { HarnessIcon } from '@/components/harness-icon';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { useFavoriteTargets } from '@/lib/use-favorite-targets';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';

export function FavoriteRelationships({
  favorite,
  onApply,
}: {
  favorite: FavoriteListItem;
  onApply(items: FavoritePlanRequest['items']): void;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const providers = useAppStore((state) => state.providers);
  const { targets, loading, error } = useFavoriteTargets(favorite);
  const [channel, setChannel] = useState(favorite.connections[0]?.id);
  const connection = favorite.connections.find((entry) => entry.id === channel);
  const status = (harness: HarnessSummary) => {
    const refs = favorite.references.filter(
      (ref) =>
        ref.harness === harness.id &&
        harness.profiles.some(
          (profile) => profile.name === ref.name && profile.modelFavorite?.connectionId === channel,
        ),
    );
    if (refs.some((ref) => ref.connectionMissing || ref.sourceMissing)) {
      return 'workspace.linkMissing';
    }
    if (refs.some((ref) => ref.diverged)) {
      return 'favorites.diverged';
    }
    if (refs.some((ref) => ref.needsUpdate)) {
      return 'favorites.needsUpdate';
    }
    if (refs.some((ref) => !harness.active?.official && ref.name === harness.active?.name)) {
      return 'workspace.inUse';
    }
    return refs.length ? 'workspace.saved' : 'workspace.available';
  };
  return (
    <section className="space-y-5" aria-label={t('workspace.relationship')}>
      <div>
        <h3 className="text-lg font-semibold">{t('workspace.relationship')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t('workspace.graphHint')}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="favorite-graph">
        <div className="space-y-3">
          <p className="workspace-eyebrow">{t('workspace.provider')}</p>
          {favorite.connections.map((entry) => (
            <Button
              key={entry.id}
              variant="outline"
              aria-pressed={entry.id === channel}
              onClick={() => setChannel(entry.id)}
              className={cn(
                'h-auto w-full justify-start whitespace-normal p-4 text-left',
                entry.id === channel && 'border-primary/60 bg-primary/5',
              )}
            >
              <Network className="text-primary" />
              <span className="min-w-0">
                <span className="block break-words">
                  {providers?.find((provider) => provider.id === entry.providerId)?.name ??
                    t('workspace.missingProvider')}
                </span>
                <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">
                  {entry.label} · {entry.protocol}
                </span>
              </span>
            </Button>
          ))}
          {!favorite.connections.length ? (
            <p className="text-sm text-muted-foreground">{t('favorites.pending')}</p>
          ) : null}
        </div>
        <ArrowRight aria-hidden className="graph-arrow size-5 text-primary" />
        <div className="space-y-3">
          <p className="workspace-eyebrow">{t('favorites.modelPicker')}</p>
          <div className="path-node-focus rounded-2xl border border-primary/40 p-5">
            <Box className="mb-4 size-6 text-primary" />
            <p className="break-words font-semibold">{favorite.name}</p>
            <p className="mt-2 break-all font-mono text-xs leading-6 text-muted-foreground">
              {connection?.requestModelId ?? t('favorites.pending')}
            </p>
          </div>
        </div>
        <ArrowRight aria-hidden className="graph-arrow size-5 text-primary" />
        <div className="space-y-3">
          <p className="workspace-eyebrow">{t('workspace.tool')}</p>
          {harnesses.map((harness) => {
            const compatible = compatibleConnections(favorite, harness.id, targets).some(
              (entry) => entry.id === channel,
            );
            return (
              <Button
                key={harness.id}
                variant="outline"
                className="h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left"
                disabled={!compatible}
                onClick={() =>
                  onApply([
                    {
                      ...favoriteSelection(favorite, harness, targets, 'activate'),
                      connectionId: channel!,
                    },
                  ])
                }
              >
                <HarnessIcon id={harness.id} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{harness.label}</span>
                  <span
                    className={cn(
                      'mt-1 block text-xs font-normal',
                      compatible ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {t(
                      loading
                        ? 'favorites.loading'
                        : compatible
                          ? status(harness)
                          : 'favorites.noCompatibleChannel',
                    )}
                  </span>
                </span>
                <ArrowRight className="shrink-0" />
              </Button>
            );
          })}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.relationshipHint')}
      </p>
    </section>
  );
}
