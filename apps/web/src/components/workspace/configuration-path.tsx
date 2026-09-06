import type { FavoriteConnection, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { ConfigurationFlow, flowEdge, flowNode } from '@/components/configuration-flow';
import { configuredModel } from '@/lib/configured-model';
import { useTranslation } from '@/lib/i18n';
import { SwitchFlow } from './switch-flow';

type Path = { provider: string; model: string; sourceLabel?: string };

export function CurrentConfigurationPath({ harness }: { harness: HarnessSummary }) {
  const { t } = useTranslation();
  const path = currentPath(harness, t);
  return (
    <>
      <section aria-label={t('workspace.currentChain')} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t('workspace.currentChain')}
          </p>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {t('workspace.activeNow')}
          </span>
        </div>
        <ConfigurationFlow
          nodes={[
            flowNode('source', 24, 40, {
              kind: 'source',
              label: path.sourceLabel!,
              value: path.provider,
            }),
            flowNode('model', 315, 40, {
              kind: 'model',
              label: t('favorites.modelPicker'),
              value: path.model,
            }),
            flowNode('tool', 606, 40, {
              kind: 'tool',
              label: t('workspace.tool'),
              value: harness.label,
              harnessId: harness.id,
            }),
          ]}
          edges={[flowEdge('source', 'model'), flowEdge('model', 'tool')]}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('workspace.currentChainHint')}
        </p>
      </section>
    </>
  );
}

export function SwitchMap({
  connection,
  harness,
  templateName,
}: {
  connection: FavoriteConnection;
  harness: HarnessSummary;
  templateName: string;
}) {
  const { t } = useTranslation();
  const candidate = {
    provider: templateName,
    model: connection.requestModelId,
  };
  return (
    <section
      aria-label={t('workspace.candidateChain', { name: harness.label })}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {t('workspace.switchMap')}
        </p>
        <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
          {t('workspace.notWritten')}
        </span>
      </div>
      <SwitchFlow current={currentPath(harness, t)} candidate={candidate} harness={harness} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.switchTargetHint', { name: harness.label })}
      </p>
    </section>
  );
}

export function currentPath(
  harness: HarnessSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
): Path {
  const profile = harness.profiles.find(
    (entry) => !harness.active?.official && entry.name === harness.active?.name,
  );
  return {
    sourceLabel: t(
      profile?.modelFavorite?.favoriteId ? 'templates.tag' : 'workspace.configuration',
    ),
    provider:
      profile?.name ??
      (harness.active?.official ? t('harness.official') : t('harness.currentInactive')),
    model: harness.active
      ? configuredModel(profile, t, harness.active.model)
      : t('harness.currentInactive'),
  };
}
