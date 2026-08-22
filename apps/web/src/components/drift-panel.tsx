import type { DriftSummary, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { GitCompareArrows, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DriftDialog, driftStatusClasses } from '@/components/drift-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type DriftPanelProps = {
  harness: HarnessSummary;
};

/**
 * Right-column card: how far the live files have drifted from what the active
 * profile would render. Opening the diff exposes the reapply / adopt actions.
 */
export function DriftPanel({ harness }: DriftPanelProps) {
  const { t } = useTranslation();
  const drift = useAppStore((state) => state.drift);
  const driftLoading = useAppStore((state) => state.driftLoading);
  const driftError = useAppStore((state) => state.driftError);
  const loadDrift = useAppStore((state) => state.loadDrift);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (drift === null) {
      void loadDrift();
    }
  }, [drift, loadDrift]);

  const report = drift?.find((item) => item.harness === harness.id) ?? null;
  const changed = report?.files.filter((file) => file.status !== 'in-sync') ?? [];

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="size-4 text-primary" />
        <h3 className="font-semibold">{t('drift.title')}</h3>
        <span className="ml-auto">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('drift.recheck')}
            onClick={() => void loadDrift()}
          >
            <RefreshCcw className={driftLoading ? 'animate-spin' : undefined} />
          </Button>
        </span>
      </div>

      <div className="mt-4">
        {driftError ? (
          <p className="text-sm text-destructive">{lineText(t, driftError)}</p>
        ) : report === null ? (
          <p className="text-sm text-muted-foreground">{t('drift.checking')}</p>
        ) : (
          <DriftBadge report={report} />
        )}
      </div>

      {report && changed.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {changed.slice(0, 3).map((file) => (
            <li key={file.key} className="flex items-center gap-2 text-xs">
              <span className="size-1.5 shrink-0 rounded-full bg-destructive/70" />
              <span className="truncate font-mono text-muted-foreground">
                {file.path.split('/').pop()}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                {t(`drift.status.${file.status}`)}
              </span>
            </li>
          ))}
          {changed.length > 3 ? (
            <li className="pl-3.5 text-xs text-muted-foreground">
              {t('drift.moreFiles', { count: changed.length - 3 })}
            </li>
          ) : null}
        </ul>
      ) : null}

      <Button
        className="mt-4 w-full"
        size="sm"
        variant="outline"
        disabled={report === null || !report.active}
        onClick={() => setOpen(true)}
      >
        {t('drift.viewDiff')}
      </Button>

      <DriftDialog harness={harness} open={open} onOpenChange={setOpen} />
    </section>
  );
}

function DriftBadge({ report }: { report: DriftSummary }) {
  const { t } = useTranslation();
  if (!report.active) {
    return <Badge variant="secondary">{t('harness.inactive')}</Badge>;
  }
  if (report.status === 'in-sync') {
    return <Badge variant="secondary">{t('drift.none')}</Badge>;
  }
  if (report.status === 'drifted') {
    const count = report.files.filter((file) => file.status !== 'in-sync').length;
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-300">
        {t('drift.mismatch', { count })}
      </Badge>
    );
  }
  return (
    <Badge className={driftStatusClasses(report.status)}>
      {t(`drift.status.${report.status}`)}
    </Badge>
  );
}
