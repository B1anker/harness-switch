import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { ArrowRight, History, Settings2 } from 'lucide-react';
import { useEffect } from 'react';
import { HarnessTabs } from '@/components/harness-tabs';
import { Button } from '@/components/ui/button';
import { TabPanel } from '@/components/ui/tabs';
import { useI18n, useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';
import { CurrentConfigurationPath } from './configuration-path';

export function Workspace({
  selectedHarnessId,
  onSelectHarness,
  onConfigure,
  onHistory,
}: {
  selectedHarnessId: HarnessId;
  onSelectHarness(id: HarnessId): void;
  onConfigure(id: HarnessId): void;
  onHistory(): void;
}) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const harnesses = useAppStore((state) => state.harnesses);
  const loadHistory = useAppStore((state) => state.loadFavoriteBackups);
  const backups = useAppStore((state) => state.favoriteBackups);
  useEffect(() => {
    void loadHistory().catch(() => {});
  }, [loadHistory]);
  const harness = harnesses.find((entry) => entry.id === selectedHarnessId) ?? harnesses[0];
  return (
    <main className="grid xl:grid-cols-[17rem_minmax(0,1fr)]">
      <HarnessTabs harnesses={harnesses} value={harness?.id} onChange={onSelectHarness} />
      <div className="min-w-0 space-y-6 p-4 sm:p-6 xl:p-8">
        <div>
          <p className="workspace-eyebrow">{t('workspace.eyebrow')}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('workspace.title')}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">{t('workspace.homeSubtitle')}</p>
        </div>
        {harness ? (
          <TabPanel
            idPrefix="harness"
            value={harness.id}
            className="workspace-surface min-w-0 space-y-7 p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">
                  {t('workspace.currentForTool', { name: harness.label })}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('workspace.currentForToolHint')}
                </p>
              </div>
              <Button onClick={() => onConfigure(harness.id)}>
                <Settings2 />
                {t('workspace.configureSwitch')}
              </Button>
            </div>
            <CurrentConfigurationPath harness={harness} />
          </TabPanel>
        ) : (
          <p>{t('workspace.noTools')}</p>
        )}
        <button
          type="button"
          onClick={onHistory}
          className="workspace-history-link group flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/60 p-5 text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-4">
            <History className="size-6 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-semibold">{t('timeline.title')}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {backups[0]
                  ? t('workspace.lastBackup', {
                      time: new Date(backups[0].createdAt).toLocaleString(locale),
                    })
                  : t('workspace.historyHint')}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-sm font-medium text-primary">
            {t('workspace.openHistory')}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" />
          </span>
        </button>
      </div>
    </main>
  );
}
