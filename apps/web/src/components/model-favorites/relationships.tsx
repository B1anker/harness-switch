import type { FavoritePlanRequest, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { ConfigurationFlow, flowEdge, flowNode } from '@/components/configuration-flow';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/tabs';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { useFavoriteTargets } from '@/lib/use-favorite-targets';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';

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
  const [channel, setChannel] = useState(favorite.connections[0]?.id);
  const [mode, setMode] = useState<'save' | 'activate'>('activate');
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
  const count = Math.max(favorite.connections.length, harnesses.length, 1);
  const height = count * 88 + 48;
  const middle = (height - 66) / 2;
  const nodes = [
    ...favorite.connections.map((entry, index) =>
      flowNode(entry.id, 24, middle - ((favorite.connections.length - 1) * 88) / 2 + index * 88, {
        kind: 'source',
        label: entry.label,
        value:
          providers?.find((provider) => provider.id === entry.providerId)?.name ??
          t('workspace.missingProvider'),
        selected: entry.id === channel,
        action: () => setChannel(entry.id),
        actionLabel: entry.label + ' · ' + entry.protocol,
      }),
    ),
    flowNode('model', 260, middle, {
      kind: 'model',
      label: t('favorites.modelPicker'),
      value: connection?.requestModelId ?? t('favorites.pending'),
    }),
    ...harnesses.map((harness, index) => {
      const compatible = compatibleConnections(favorite, harness.id, targets).some(
        (entry) => entry.id === channel,
      );
      const label = t(
        loading
          ? 'favorites.loading'
          : compatible
            ? status(harness)
            : 'favorites.noCompatibleChannel',
      );
      return flowNode(harness.id, 606, middle - ((harnesses.length - 1) * 88) / 2 + index * 88, {
        kind: 'tool',
        harnessId: harness.id,
        label,
        value: harness.label,
        disabled: !compatible || loading,
        actionLabel: harness.label + ' ' + label,
        action: () =>
          onApply([
            {
              ...favoriteSelection(favorite, harness, targets, mode),
              connectionId: channel!,
            },
          ]),
      });
    }),
  ];
  const edges = connection
    ? [
        flowEdge(connection.id, 'model'),
        ...harnesses
          .filter((harness) =>
            compatibleConnections(favorite, harness.id, targets).some(
              (entry) => entry.id === channel,
            ),
          )
          .map((harness) => flowEdge('model', harness.id)),
      ]
    : [];
  return (
    <section className="space-y-5" aria-label={t('workspace.relationship')}>
      <div>
        <h3 className="text-lg font-semibold">{t('workspace.relationship')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t('workspace.graphHint')}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <SegmentedControl
        options={['save', 'activate'] as const}
        value={mode}
        onChange={setMode}
        className="max-w-sm"
      >
        {(value) =>
          t(value === 'save' ? 'favorites.modeLabel.save' : 'favorites.modeLabel.activate')
        }
      </SegmentedControl>
      <ConfigurationFlow nodes={nodes} edges={edges} height={height} />
      {connection ? (
        <p className="break-all text-xs text-muted-foreground">
          {connection.protocol} ·{' '}
          {
            providers
              ?.find((entry) => entry.id === connection.providerId)
              ?.endpoints.find((entry) => entry.key === connection.endpointKey)?.baseUrl
          }
        </p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onEditConnections}>
        {t('favorites.relationships.editConnection')}
      </Button>
      {!favorite.connections.length ? (
        <p className="text-sm text-muted-foreground">{t('favorites.pending')}</p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.relationshipHint')}
      </p>
    </section>
  );
}
