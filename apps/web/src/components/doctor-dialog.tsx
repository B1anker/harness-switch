import {
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorReport,
  HARNESS_LABELS,
  type HarnessId,
} from '@seaveyon/harness-switch-shared';
import { RefreshCcw, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type DoctorDialogProps = {
  harnessId: HarnessId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_DOT: Record<DoctorCheckStatus, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  unknown: 'bg-slate-400',
};

/**
 * Doctor: one-shot local health report for a single harness.
 */
export function DoctorDialog({ harnessId, open, onOpenChange }: DoctorDialogProps) {
  const { t } = useTranslation();
  const doctor = useAppStore((state) => state.doctor);
  const doctorLoading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const doctorUpdatedAvailable = useAppStore((state) => state.doctorUpdatedAvailable);
  const loadDoctor = useAppStore((state) => state.loadDoctor);

  const report = doctor?.find((item) => item.harness === harnessId) ?? null;

  useEffect(() => {
    if (open && report === null) {
      void loadDoctor(harnessId);
    }
  }, [open, report, harnessId, loadDoctor]);

  const summary = summarize(report);
  const label = HARNESS_LABELS[harnessId];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1.5 px-6 pb-4 pt-6 pr-12">
          <DialogTitle>{t('doctor.titleFor', { harness: label })}</DialogTitle>
          <DialogDescription>{t('doctor.intro')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6">
          {doctorLoading && report === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('doctor.checking')}</p>
          ) : null}
          {doctorError ? (
            <p className="text-sm text-destructive">{lineText(t, doctorError)}</p>
          ) : null}

          {report ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {summary.ok > 0 ? (
                  <Badge variant="secondary">{t('doctor.countOk', { count: summary.ok })}</Badge>
                ) : null}
                {summary.warn > 0 ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 text-amber-700 dark:text-amber-300"
                  >
                    {t('doctor.countWarn', { count: summary.warn })}
                  </Badge>
                ) : null}
                {summary.error > 0 ? (
                  <Badge variant="destructive">
                    {t('doctor.countError', { count: summary.error })}
                  </Badge>
                ) : null}
                {summary.unknown > 0 ? (
                  <Badge variant="outline">
                    {t('doctor.countUnknown', { count: summary.unknown })}
                  </Badge>
                ) : null}
                {doctorUpdatedAvailable ? (
                  <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="size-3.5" />
                    {t('doctor.updateAvailable')}
                  </span>
                ) : null}
              </div>

              <CheckList checks={report.checks} />
            </>
          ) : null}
          {report === null && !doctorLoading && !doctorError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('doctor.notRun')}</p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 px-6 py-4">
          <Button
            variant="outline"
            disabled={doctorLoading}
            onClick={() => void loadDoctor(harnessId)}
          >
            <RefreshCcw className={doctorLoading ? 'animate-spin' : undefined} />
            {t('doctor.rerun')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('doctor.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckList({ checks }: { checks: DoctorCheck[] }) {
  const { t } = useTranslation();
  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('doctor.noChecks')}</p>;
  }
  return (
    <ul className="divide-y rounded-xl border">
      {checks.map((check) => (
        <li key={check.id} className="flex items-start gap-3 px-3 py-2.5">
          <span
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT[check.status])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="text-sm leading-relaxed">
                {lineText(t, { key: checkKey(check), params: check.params, fallback: check.label })}
              </p>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {t(`doctor.status.${check.status}`)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Catalog key for a check. A server that predates the code contract sends none, and
 * `lineText` then renders the `label` prose it did send.
 */
function checkKey(check: DoctorCheck): string {
  return check.code ?? 'doctor.unknownCheck';
}

type Summary = { ok: number; warn: number; error: number; unknown: number };

function summarize(report: DoctorReport | null): Summary {
  const summary: Summary = { ok: 0, warn: 0, error: 0, unknown: 0 };
  if (!report) return summary;
  for (const check of report.checks) {
    summary[check.status]++;
  }
  return summary;
}
