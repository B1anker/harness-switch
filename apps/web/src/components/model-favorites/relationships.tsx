import { catalogKey, type FavoritePlanRequest } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { useFavoriteTargets } from '@/lib/use-favorite-targets';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { FavoriteSelect } from './fields';

export function FavoriteRelationships({
  favorite,
  onApply,
  onEditConnections,
}: {
  favorite: FavoriteListItem;
  onApply(items: FavoritePlanRequest['items']): void;
  onEditConnections(): void;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const providers = useAppStore((state) => state.providers);
  const { targets, loading, error } = useFavoriteTargets(favorite);
  const [channel, setChannel] = useState(favorite.connections[0]?.id ?? '');
  const connection = favorite.connections.find((entry) => entry.id === channel);
  const provider = providers?.find((entry) => entry.id === connection?.providerId);
  const endpoint = provider?.endpoints.find((entry) => entry.key === connection?.endpointKey);
  return (
    <section className="min-w-0 space-y-5" aria-label={t('workspace.relationship')}>
      <div>
        <h3 className="text-lg font-semibold">{t('workspace.relationship')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('favorites.relationships.hint')}
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!connection ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">
            {t('favorites.relationships.noConnection')}
          </p>
          <Button variant="outline" onClick={onEditConnections}>
            {t('favorites.relationships.editConnection')}
          </Button>
        </div>
      ) : (
        <>
          <div className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-4">
            {favorite.connections.length > 1 ? (
              <FavoriteSelect
                id="favorite-relationship-connection"
                label={t('favorites.relationships.chooseConnection')}
                value={channel}
                options={favorite.connections.map((entry) => ({
                  value: entry.id,
                  label: `${entry.label || entry.requestModelId} · ${entry.protocol}`,
                }))}
                onChange={setChannel}
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {t('favorites.relationships.requestModel')}
              </p>
              <p className="mt-1 break-all font-mono text-sm font-medium">
                {connection.requestModelId}
              </p>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                {provider?.name ?? t('workspace.missingProvider')} · {connection.protocol}
              </p>
              {endpoint ? (
                <p className="mt-1 break-all text-xs text-muted-foreground">{endpoint.baseUrl}</p>
              ) : null}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {harnesses.map((harness) => {
              const refs = favorite.references.filter((ref) => ref.harness === harness.id);
              const linked = harness.profiles.filter(
                (profile) => profile.modelFavorite?.favoriteId === favorite.id,
              );
              const active =
                !harness.active?.official &&
                linked.some((profile) => profile.name === harness.active?.name);
              const compatible = compatibleConnections(favorite, harness.id, targets).some(
                (entry) => entry.id === channel,
              );
              const blockers =
                targets
                  ?.find((target) => target.harness === harness.id)
                  ?.connections.find((entry) => entry.id === channel)?.projection.blockers ?? [];
              const selection = (mode: 'save' | 'activate') => {
                const item = favoriteSelection(favorite, harness, targets, mode);
                return { ...item, connectionId: channel };
              };
              return (
                <article
                  key={harness.id}
                  aria-label={harness.label}
                  className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold">{harness.label}</h4>
                    {active ? <Badge>{t('workspace.inUse')}</Badge> : null}
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      {t(
                        refs.length
                          ? 'favorites.relationships.savedCount'
                          : loading
                            ? 'favorites.loading'
                            : compatible
                              ? 'workspace.available'
                              : 'favorites.noCompatibleChannel',
                        { count: refs.length },
                      )}
                    </p>
                    {refs.some((ref) => ref.needsUpdate) ? (
                      <p>{t('favorites.needsUpdate')}</p>
                    ) : null}
                    {refs.some((ref) => ref.diverged) ? <p>{t('favorites.diverged')}</p> : null}
                    {refs.some((ref) => ref.connectionMissing || ref.sourceMissing) ? (
                      <p>{t('workspace.linkMissing')}</p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!compatible || loading}
                      onClick={() => onApply([selection('save')])}
                    >
                      {t('favorites.relationships.save')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!compatible || loading}
                      onClick={() => onApply([selection('activate')])}
                    >
                      {t('favorites.relationships.switch')}
                    </Button>
                  </div>
                  {loading ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      {t('favorites.loading')}
                    </p>
                  ) : !compatible ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {blockers.length
                          ? blockers
                              .map((issue) => t(catalogKey(issue.code), issue.data))
                              .join('；')
                          : t('favorites.noCompatibleHint')}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto max-w-full whitespace-normal p-0 text-left"
                        onClick={onEditConnections}
                      >
                        {t('favorites.relationships.editConnection')}
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {!harnesses.length ? (
            <p className="text-sm text-muted-foreground">{t('workspace.noTools')}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
