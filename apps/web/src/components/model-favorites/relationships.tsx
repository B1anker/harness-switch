import type {
  FavoriteConnection,
  FavoritePlanRequest,
  HarnessSummary,
} from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { ConfigurationFlow, flowEdge, flowNode } from '@/components/configuration-flow';
import { Alert } from '@/components/ui/alert';
import { SegmentedControl } from '@/components/ui/tabs';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { useFavoriteTargets } from '@/lib/use-favorite-targets';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { accountClusters, accountLabel } from './editor/model-groups';
import { FavoriteSelect } from './fields';

const clusterNodeId = (cluster: FavoriteConnection[]) =>
  cluster[0]!.groupId ?? cluster[0]!.providerId ?? cluster[0]!.id;

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
  const [channel, setChannel] = useState(
    favorite.defaultConnectionId ?? favorite.connections[0]?.id,
  );
  const [mode, setMode] = useState<'save' | 'activate'>('activate');
  const connection = favorite.connections.find((entry) => entry.id === channel);
  // Same account + same models under two protocols (cpa / cpa · codex) collapse to one
  // node; the tool's apply path picks the protocol it can speak.
  const clusters = accountClusters(favorite.connections);
  const selectedCluster =
    clusters.find((cluster) => cluster.some((entry) => entry.id === channel)) ?? [];
  const models = [
    ...new Map(
      selectedCluster
        .filter((entry) => entry.requestModelId)
        .map((entry) => [entry.requestModelId, entry] as const),
    ).entries(),
  ];
  const pickFromCluster = (cluster: FavoriteConnection[], modelId?: string) => {
    const wanted = modelId ?? connection?.requestModelId;
    const sameModel = wanted ? cluster.filter((entry) => entry.requestModelId === wanted) : cluster;
    return (sameModel.find((entry) => entry.id === channel) ??
      sameModel.find((entry) => entry.id === favorite.defaultConnectionId) ??
      sameModel.find((entry) => entry.protocol === connection?.protocol) ??
      sameModel[0] ??
      cluster[0])!.id;
  };
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
  const count = Math.max(clusters.length, harnesses.length, 1);
  const height = count * 88 + 48;
  const middle = (height - 66) / 2;
  const nodes = [
    ...clusters.map((cluster, index) => {
      const entry = cluster[0]!;
      const provider =
        providers?.find((item) => item.id === entry.providerId)?.name ??
        t('workspace.missingProvider');
      const title = accountLabel(cluster, provider);
      const protocols = [...new Set(cluster.map((item) => item.protocol))];
      const modelCount = new Set(cluster.map((item) => item.requestModelId).filter(Boolean)).size;
      const caption = [
        protocols.join(' · '),
        modelCount > 1 ? t('favorites.scheme.selectedCount', { count: modelCount }) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return flowNode(
        clusterNodeId(cluster),
        24,
        middle - ((clusters.length - 1) * 88) / 2 + index * 88,
        {
          kind: 'source',
          label: caption,
          value: title,
          selected: cluster.some((item) => item.id === channel),
          action: () => setChannel(pickFromCluster(cluster)),
          actionLabel: title + ' · ' + caption,
        },
      );
    }),
    flowNode('model', 260, middle, {
      kind: 'model',
      label: t('favorites.modelPicker'),
      value: connection?.requestModelId ?? t('favorites.pending'),
    }),
    ...harnesses.map((harness, index) => {
      const usable = compatibleConnections(favorite, harness.id, targets);
      const compatible = usable.some((entry) => entry.id === channel);
      // A tool that cannot take the selected channel may still take the same model over
      // another protocol (Codex's Responses copy of an account, say); offer that instead
      // of a dead end, since the apply dialog would pick it anyway.
      const fallback =
        usable.find((entry) => entry.requestModelId === connection?.requestModelId) ?? usable[0];
      const label = t(
        loading
          ? 'favorites.loading'
          : compatible
            ? status(harness)
            : fallback
              ? 'favorites.otherChannelAvailable'
              : 'favorites.noCompatibleChannel',
      );
      return flowNode(harness.id, 606, middle - ((harnesses.length - 1) * 88) / 2 + index * 88, {
        kind: 'tool',
        harnessId: harness.id,
        label,
        value: harness.label,
        disabled: loading || (!compatible && !fallback),
        actionLabel: harness.label + ' ' + label,
        action: () =>
          onApply([
            {
              ...favoriteSelection(favorite, harness, targets, mode),
              connectionId: compatible ? channel! : fallback!.id,
            },
          ]),
      });
    }),
  ];
  const edges = connection
    ? [
        flowEdge(clusterNodeId(selectedCluster), 'model'),
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
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl
          options={['save', 'activate'] as const}
          value={mode}
          onChange={setMode}
          className="w-full max-w-sm"
        >
          {(value) =>
            t(value === 'save' ? 'favorites.modeLabel.save' : 'favorites.modeLabel.activate')
          }
        </SegmentedControl>
        {models.length > 1 ? (
          <FavoriteSelect
            id="relationship-model"
            label={t('favorites.modelPicker')}
            value={channel ?? ''}
            options={models.map(([model]) => ({
              value: pickFromCluster(selectedCluster, model),
              label: model,
            }))}
            onChange={(value) => setChannel(value)}
            className="w-72 font-mono text-xs"
          />
        ) : null}
      </div>
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
      {!favorite.connections.length ? (
        <p className="text-sm text-muted-foreground">{t('favorites.pending')}</p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.relationshipHint')}
      </p>
    </section>
  );
}
