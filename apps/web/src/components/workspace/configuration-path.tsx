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
      <div className="switch-tree">
        <div className="switch-tree-branches">
          <PathBranch
            label={t('workspace.currentChain')}
            path={currentPath(harness, t)}
            sourceLabel={t('workspace.configuration')}
          />
          <PathBranch
            label={t('workspace.candidateChain', { name: harness.label })}
            path={candidate}
            candidate
          />
        </div>
        <div aria-hidden className="switch-tree-merge" />
        <ol className="switch-tree-tool">
          <PathNode
            icon={<HarnessIcon id={harness.id} />}
            label={t('workspace.tool')}
            value={harness.label}
          />
        </ol>
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
  sourceLabel,
}: {
  path: Path;
  harness: HarnessSummary;
  sourceLabel?: string;
}) {
  return (
    <div className="configuration-path-frame">
      <PathSteps path={path} harness={harness} sourceLabel={sourceLabel} />
    </div>
  );
}

function PathBranch({
  path,
  candidate = false,
  label,
  sourceLabel,
}: {
  path: Path;
  candidate?: boolean;
  label: string;
  sourceLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={candidate ? 'switch-branch switch-branch-candidate' : 'switch-branch'}>
      <p className="switch-branch-label">{label}</p>
      <ol className="switch-branch-path">
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
      </ol>
    </div>
  );
}

function PathSteps({
  path,
  harness,
  sourceLabel,
}: {
  path: Path;
  harness: HarnessSummary;
  sourceLabel?: string;
}) {
  const { t } = useTranslation();
  return (
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
