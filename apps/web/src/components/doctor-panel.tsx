import type {
  DoctorCheckStatus,
  DoctorReport,
  DriftSummary,
  HarnessSummary,
} from '@seaveyon/harness-switch-shared';
import { RefreshCcw, Stethoscope, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DoctorDialog } from '@/components/doctor-dialog';
import { DriftDialog, driftStatusClasses } from '@/components/drift-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type DoctorPanelProps = {
  harness: HarnessSummary;
};

/**
 * Doctor and drift for one harness, read from the store. `HealthBanner` is the one that
 * loads them: it is always mounted on the tool page, so `DoctorRow` inside the folded
 * details can stay effect-free and never fetch a second time.
 */
function useHarnessHealth(harness: HarnessSummary) {
  const doctor = useAppStore((state) => state.doctor);
  const doctorLoading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const loadDoctor = useAppStore((state) => state.loadDoctor);
  const drift = useAppStore((state) => state.drift);
  const driftLoading = useAppStore((state) => state.driftLoading);
  const driftError = useAppStore((state) => state.driftError);
  const loadDrift = useAppStore((state) => state.loadDrift);

  const report = doctor?.find((item) => item.harness === harness.id) ?? null;
  const driftReport = drift?.find((item) => item.harness === harness.id) ?? null;
  const changed = driftReport?.files.filter((file) => file.status !== 'in-sync') ?? [];
  const drifted = driftReport !== null && driftReport.active && driftReport.status !== 'in-sync';
  const summary = report ? countByStatus(report) : null;
  const unhealthy = summary !== null && summary.error + summary.warn > 0;

  function refresh() {
    void loadDoctor(harness.id);
    void loadDrift();
  }

  return {
    report,
    summary,
    unhealthy,
    doctorError,
    driftReport,
    driftError,
    changed,
    drifted,
    refreshing: doctorLoading || driftLoading,
    refresh,
    loadDoctor,
    loadDrift,
    drift,
  };
}

/**
 * Shows up above the configuration list only when something needs attention: a doctor
 * warning or error, or live files that no longer match the active configuration. A
 * healthy harness renders nothing here; its report stays reachable from the details.
 */
export function HealthBanner({ harness }: DoctorPanelProps) {
  const { t } = useTranslation();
  const health = useHarnessHealth(harness);
  const { loadDoctor, loadDrift, drift } = health;
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);

  useEffect(() => {
    void loadDoctor(harness.id);
  }, [harness.id, loadDoctor]);

  useEffect(() => {
    if (drift === null) {
      void loadDrift();
    }
  }, [drift, loadDrift]);

  const showDiff = health.drifted && health.changed.length > 0;
  if (!health.unhealthy && !health.drifted) {
    return null;
  }
  const severe = (health.summary?.error ?? 0) > 0;

  return (
    <section
      className={cn(
        'rounded-2xl border p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]',
        severe
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10',
      )}
    >
      <div className="flex items-center gap-2">
        <TriangleAlert
          className={cn(
            'size-4',
            severe ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
          )}
        />
        <h3 className="font-semibold">{t('doctor.title')}</h3>
        <span className="ml-auto">
          <RefreshButton refreshing={health.refreshing} onClick={health.refresh} />
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {health.unhealthy && health.report ? (
          <SummaryBadges report={health.report} statuses={['error', 'warn']} />
        ) : null}
        {health.drifted && health.driftReport ? (
          <div className="space-y-2">
            <DriftBadge report={health.driftReport} />
            {health.changed.length > 0 ? (
              <ul className="space-y-1">
                {health.changed.slice(0, 3).map((file) => (
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
                {health.changed.length > 3 ? (
                  <li className="pl-3.5 text-xs text-muted-foreground">
                    {t('drift.moreFiles', { count: health.changed.length - 3 })}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={health.report === null}
          onClick={() => setDoctorOpen(true)}
        >
          {t('doctor.viewDetails')}
        </Button>
        {showDiff ? (
          <Button size="sm" variant="outline" onClick={() => setDriftOpen(true)}>
            {t('drift.viewDiff')}
          </Button>
        ) : null}
      </div>

      <DoctorDialog harnessId={harness.id} open={doctorOpen} onOpenChange={setDoctorOpen} />
      <DriftDialog harness={harness} open={driftOpen} onOpenChange={setDriftOpen} />
    </section>
  );
}

/**
 * The compact doctor line inside the folded details: status badges, the full report and a
 * rerun. This is where a healthy harness's report lives once the banner has nothing to say.
 */
export function DoctorRow({ harness }: DoctorPanelProps) {
  const { t } = useTranslation();
  const health = useHarnessHealth(harness);
  const [doctorOpen, setDoctorOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Stethoscope className="size-4 text-primary" />
        <h4 className="text-sm font-semibold">{t('doctor.title')}</h4>
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={health.report === null}
            onClick={() => setDoctorOpen(true)}
          >
            {t('doctor.viewDetails')}
          </Button>
          <RefreshButton refreshing={health.refreshing} onClick={health.refresh} />
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {health.doctorError ? (
          <p className="text-sm text-destructive">{lineText(t, health.doctorError)}</p>
        ) : health.report === null ? (
          <p className="text-sm text-muted-foreground">{t('doctor.checking')}</p>
        ) : (
          <SummaryBadges report={health.report} />
        )}
        {health.driftError ? (
          <p className="text-sm text-destructive">{lineText(t, health.driftError)}</p>
        ) : health.driftReport === null ? (
          <p className="text-sm text-muted-foreground">{t('drift.checking')}</p>
        ) : (
          <DriftBadge report={health.driftReport} />
        )}
      </div>
      <DoctorDialog harnessId={harness.id} open={doctorOpen} onOpenChange={setDoctorOpen} />
    </div>
  );
}

function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick(): void }) {
  const { t } = useTranslation();
  return (
    <Button size="icon" variant="ghost" aria-label={t('doctor.rerun')} onClick={onClick}>
      <RefreshCcw className={refreshing ? 'animate-spin' : undefined} />
    </Button>
  );
}

function SummaryBadges({
  report,
  statuses = ['error', 'warn', 'ok', 'unknown'],
}: {
  report: DoctorReport;
  /** The banner lists only what is wrong; the details row lists everything. */
  statuses?: readonly DoctorCheckStatus[];
}) {
  const { t } = useTranslation();
  const summary = countByStatus(report);
  const entries = statuses.filter((status) => summary[status] > 0);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('doctor.noChecks')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map((status) => (
        <Badge
          key={status}
          variant={badgeVariant(status)}
          className={
            status === 'warn' ? 'border-amber-500/30 text-amber-700 dark:text-amber-300' : undefined
          }
        >
          {t(`doctor.count${capitalize(status)}`, { count: summary[status] })}
        </Badge>
      ))}
    </div>
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

function countByStatus(report: DoctorReport): Record<DoctorCheckStatus, number> {
  const summary: Record<DoctorCheckStatus, number> = {
    ok: 0,
    warn: 0,
    error: 0,
    unknown: 0,
  };
  for (const check of report.checks) {
    summary[check.status]++;
  }
  return summary;
}

function badgeVariant(status: DoctorCheckStatus): 'secondary' | 'outline' | 'destructive' {
  if (status === 'error') {
    return 'destructive';
  }
  if (status === 'ok') {
    return 'secondary';
  }
  return 'outline';
}

function capitalize(status: DoctorCheckStatus): string {
  return `${status[0]!.toUpperCase()}${status.slice(1)}`;
}
