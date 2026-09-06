import type { FavoriteBackupEntry } from '@seaveyon/harness-switch-shared';
import {
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Clock3,
  History,
  Loader2,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { BackupImpact } from '@/components/backup-impact';
import { HarnessIcon } from '@/components/harness-icon';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useI18n, useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { useTimeline } from './use-timeline';

export function RecoveryTimeline() {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const state = useTimeline();
  const harnesses = useAppStore((store) => store.harnesses);
  const description = (entry: FavoriteBackupEntry) =>
    entry.context
      ? t(`favorites.backupAction.${entry.context.action}`, {
          name: entry.context.name ?? '',
          tools:
            entry.context.tools?.map((tool) => t(`favorites.toolNames.${tool}`)).join(' / ') ?? '',
        })
      : t(`favorites.backupReason.${entry.reason}`);
  const date = (entry: FavoriteBackupEntry) => new Date(entry.createdAt).toLocaleString(locale);
  const index = state.backups.findIndex((entry) => entry.id === state.selected?.id);
  const surrounding = [state.backups[index + 2], state.backups[index + 1]].filter(
    (entry) => entry !== undefined,
  );
  return (
    <main className="workspace-page space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="workspace-eyebrow">{t('timeline.eyebrow')}</p>
          <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('timeline.title')}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{t('timeline.subtitle')}</p>
        </div>
        <Button variant="outline" disabled={state.writing} onClick={() => void state.create()}>
          {state.writing ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('favorites.backupNow')}
        </Button>
      </div>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.notice ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"
        >
          <ShieldCheck className="size-4 text-primary" />
          {state.notice}
        </p>
      ) : null}
      <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label={t('timeline.points')} className="timeline-rail space-y-2">
          <button
            type="button"
            aria-current={!state.selected ? 'true' : undefined}
            disabled={state.writing}
            onClick={() => void state.select(null)}
            className={cn('timeline-point', !state.selected && 'timeline-point-selected')}
          >
            <ShieldCheck className="size-5 shrink-0" />
            <span>
              <strong className="block text-sm">{t('timeline.current')}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t('timeline.currentHint')}
              </span>
            </span>
          </button>
          {state.loading ? (
            <p role="status" className="p-4 text-sm">
              {t('favorites.loading')}
            </p>
          ) : null}
          {state.backups.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={state.writing}
              aria-current={state.selected?.id === entry.id ? 'true' : undefined}
              className={cn(
                'timeline-point',
                state.selected?.id === entry.id && 'timeline-point-selected',
              )}
              onClick={() => void state.select(entry.id)}
            >
              <Clock3 className="size-4 shrink-0" />
              <span className="min-w-0">
                <time dateTime={entry.createdAt} className="block text-xs tabular-nums">
                  {date(entry)}
                </time>
                <strong className="mt-2 block break-words text-sm font-medium">
                  {description(entry)}
                </strong>
              </span>
            </button>
          ))}
          {!state.loading && !state.backups.length ? (
            <p className="p-4 text-sm leading-6 text-muted-foreground">
              {t('favorites.backupEmpty')}
            </p>
          ) : null}
          <p className="p-4 text-xs leading-6 text-muted-foreground">{t('favorites.backupHint')}</p>
        </nav>
        <div className="min-w-0">
          {state.selected ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <History className="size-4" />
                  {t('timeline.snapshot')}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.writing || index === state.backups.length - 1}
                    onClick={() => void state.select(state.backups[index + 1]!.id)}
                  >
                    <ArrowLeft />
                    {t('timeline.older')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.writing || index <= 0}
                    onClick={() => void state.select(state.backups[index - 1]!.id)}
                  >
                    {t('timeline.newer')}
                    <ArrowRight />
                  </Button>
                </div>
              </div>
              <div className="snapshot-stack" style={{ paddingTop: surrounding.length * 22 }}>
                {surrounding.map((entry, offset) => (
                  <div
                    aria-hidden
                    key={entry.id}
                    className="snapshot-behind"
                    style={{
                      top: offset * 22,
                      left: (surrounding.length - offset) * 18,
                      right: (surrounding.length - offset) * 18,
                    }}
                  >
                    <span>
                      {date(entry)} · {description(entry)}
                    </span>
                  </div>
                ))}
                <section
                  key={state.selected.id}
                  className="workspace-surface snapshot-front relative flex flex-col gap-4 p-5 sm:p-6"
                  aria-label={t('favorites.restoreReview')}
                >
                  <div className="flex items-start gap-4">
                    <ArchiveRestore className="mt-1 size-6 shrink-0 text-primary" />
                    <div>
                      <h3 className="text-xl font-semibold tabular-nums">{date(state.selected)}</h3>
                      <p className="mt-2 break-words text-sm text-muted-foreground">
                        {description(state.selected)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t('timeline.snapshotHint')}
                  </p>
                  <div className="snapshot-impact min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                    {state.checking ? (
                      <p
                        role="status"
                        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
                      >
                        <Loader2 className="size-4 animate-spin" />
                        {t('favorites.restoreChecking')}
                      </p>
                    ) : state.impact ? (
                      <BackupImpact preview={state.impact} />
                    ) : null}
                  </div>
                  <Alert variant="warning">{t('favorites.restoreScope')}</Alert>
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <Button
                      variant="outline"
                      disabled={state.writing || state.checking}
                      onClick={() => void state.select(state.selected!.id)}
                    >
                      {t('favorites.restoreRecheck')}
                    </Button>
                    <Button
                      size="lg"
                      disabled={
                        state.writing ||
                        !state.impact?.files.some((file) => file.action !== 'unchanged')
                      }
                      onClick={() => void state.restore()}
                    >
                      {state.writing ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}
                      {t('timeline.restore')}
                    </Button>
                  </div>
                </section>
              </div>
              <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-4" />
                {t('timeline.protection')}
              </p>
            </>
          ) : (
            <section className="workspace-surface space-y-6 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-7 text-primary" />
                <h3 className="text-xl font-semibold">{t('timeline.current')}</h3>
              </div>
              <p className="text-sm leading-7 text-muted-foreground">
                {t('timeline.currentDescription')}
              </p>
              <div className="divide-y">
                {harnesses.map((harness) => (
                  <div key={harness.id} className="flex items-center gap-3 py-4">
                    <HarnessIcon id={harness.id} />
                    <span className="text-sm font-medium">{harness.label}</span>
                    <span className="ml-auto min-w-0 max-w-[55%] break-all text-right font-mono text-xs text-muted-foreground">
                      {harness.active?.model ||
                        t(
                          harness.active?.official ? 'harness.official' : 'harness.currentInactive',
                        )}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-primary">{t('timeline.selectHint')}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
