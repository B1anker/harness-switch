import type {
  DoctorCheckStatus,
  DoctorReport,
  DriftSummary,
  HarnessSummary,
} from '@seaveyon/harness-switch-shared';
import { RefreshCcw, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DoctorDialog } from '@/components/doctor-dialog';
import { DriftDialog, driftStatusClasses } from '@/components/drift-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type DoctorPanelProps = {
  harness: HarnessSummary;
};

/**
 * Right-column card: local health checks plus live-vs-active drift for one harness.
 */
export function DoctorPanel({ harness }: DoctorPanelProps) {
  const { t } = useTranslation();
  const doctor = useAppStore((state) => state.doctor);
  const doctorLoading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const loadDoctor = useAppStore((state) => state.loadDoctor);
  const drift = useAppStore((state) => state.drift);
  const driftLoading = useAppStore((state) => state.driftLoading);
  const driftError = useAppStore((state) => state.driftError);
  const loadDrift = useAppStore((state) => state.loadDrift);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);

  const report = doctor?.find((item) => item.harness === harness.id) ?? null;
  const driftReport = drift?.find((item) => item.harness === harness.id) ?? null;
  const changed = driftReport?.files.filter((file) => file.status !== 'in-sync') ?? [];
  const refreshing = doctorLoading || driftLoading;
  const showDiff =
    driftReport !== null &&
    driftReport.active &&
    changed.length > 0 &&
    driftReport.status !== 'in-sync';

  useEffect(() => {
    void loadDoctor(harness.id);
  }, [harness.id, loadDoctor]);

  useEffect(() => {
    if (drift === null) {
      void loadDrift();
    }
  }, [drift, loadDrift]);

  function refresh() {
    void loadDoctor(harness.id);
    void loadDrift();
  }

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]">
      <div className="flex items-center gap-2">
        <Stethoscope className="size-4 text-primary" />
        <h3 className="font-semibold">{t('doctor.title')}</h3>
        <span className="ml-auto">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('doctor.rerun')}
            onClick={() => refresh()}
          >
            <RefreshCcw className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {doctorError ? (
          <p className="text-sm text-destructive">{lineText(t, doctorError)}</p>
        ) : report === null ? (
          <p className="text-sm text-muted-foreground">{t('doctor.checking')}</p>
        ) : (
          <SummaryBadges report={report} />
        )}

        {driftError ? (
          <p className="text-sm text-destructive">{lineText(t, driftError)}</p>
        ) : driftReport === null ? (
          <p className="text-sm text-muted-foreground">{t('drift.checking')}</p>
        ) : (
          <div className="space-y-2">
            <DriftBadge report={driftReport} />
            {changed.length > 0 ? (
              <ul className="space-y-1">
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
          </div>
        )}
      </div>

      <div className={`mt-4 grid gap-2 ${showDiff ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Button
          size="sm"
          variant="outline"
          disabled={report === null}
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

function SummaryBadges({ report }: { report: DoctorReport }) {
  const { t } = useTranslation();
  const summary = countByStatus(report);
  const entries = (['error', 'warn', 'ok', 'unknown'] as const).filter(
    (status) => summary[status] > 0,
  );

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
