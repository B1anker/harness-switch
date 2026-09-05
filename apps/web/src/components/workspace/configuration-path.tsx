import type { FavoriteConnection, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { ArrowRight, Box, Network } from 'lucide-react';
import type { ReactNode } from 'react';
import { HarnessIcon } from '@/components/harness-icon';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';

type Path = { provider: string; model: string };

export function CurrentConfigurationPath({ harness }: { harness: HarnessSummary }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('workspace.currentChain')} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {t('workspace.currentChain')}
        </p>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {t('workspace.activeNow')}
        </span>
      </div>
      <PathLane
        path={currentPath(harness, t)}
        harness={harness}
        sourceLabel={t('workspace.configuration')}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.currentChainHint')}
      </p>
    </section>
  );
}

export function SwitchMap({
  connection,
  harness,
}: {
  connection: FavoriteConnection;
  harness: HarnessSummary;
}) {
  const { t } = useTranslation();
  const provider = useAppStore((state) =>
    state.providers?.find((entry) => entry.id === connection.providerId),
  );
  const candidate = {
    provider: provider?.name ?? t('workspace.missingProvider'),
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
      <div className="switch-map">
        <PathLane
          label={t('workspace.currentChain')}
          path={currentPath(harness, t)}
          harness={harness}
          sourceLabel={t('workspace.configuration')}
        />
        <PathLane
          label={t('workspace.candidateChain', { name: harness.label })}
          path={candidate}
          harness={harness}
          candidate
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.switchTargetHint', { name: harness.label })}
      </p>
    </section>
  );
}

function PathLane({
  path,
  harness,
  candidate = false,
  label,
  sourceLabel,
}: {
  path: Path;
  harness: HarnessSummary;
  candidate?: boolean;
  label?: string;
  sourceLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={candidate ? 'switch-lane switch-lane-candidate' : 'switch-lane'}>
      {label ? <p className="switch-lane-label">{label}</p> : null}
      <ol className="configuration-path">
        <PathNode
          icon={<Network className="text-primary" />}
          label={sourceLabel ?? t('workspace.provider')}
          value={path.provider}
        />
        <li aria-hidden className="path-arrow">
          <ArrowRight />
        </li>
        <PathNode
          icon={<Box className="text-primary" />}
          label={t('favorites.modelPicker')}
          value={path.model}
          mono
        />
        <li aria-hidden className="path-arrow">
          <ArrowRight />
        </li>
        <PathNode
          icon={<HarnessIcon id={harness.id} />}
          label={t('workspace.tool')}
          value={harness.label}
        />
      </ol>
    </div>
  );
}

function PathNode({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <li className="path-node">
      {icon}
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong
          className={mono ? 'block break-all font-mono text-xs' : 'block break-words text-sm'}
        >
          {value}
        </strong>
      </span>
    </li>
  );
}

function currentPath(
  harness: HarnessSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
): Path {
  const profile = harness.profiles.find(
    (entry) => !harness.active?.official && entry.name === harness.active?.name,
  );
  return {
    provider:
      profile?.name ??
      (harness.active?.official ? t('harness.official') : t('harness.currentInactive')),
    model: harness.active?.model ?? t('harness.currentInactive'),
  };
}
