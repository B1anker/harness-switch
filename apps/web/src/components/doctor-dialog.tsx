import type { DoctorCheck, DoctorCheckStatus, DoctorReport } from '@seaveyon/harness-switch-shared';
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
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type DoctorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_DOT: Record<DoctorCheckStatus, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  unknown: 'bg-slate-400',
};

const STATUS_LABEL: Record<DoctorCheckStatus, string> = {
  ok: '正常',
  warn: '警告',
  error: '错误',
  unknown: '未知',
};

/**
 * Doctor: one-shot local health report per harness. Each check carries a status
 * dot and a label; 重新诊断 re-runs the whole report.
 */
export function DoctorDialog({ open, onOpenChange }: DoctorDialogProps) {
  const doctor = useAppStore((state) => state.doctor);
  const doctorLoading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const doctorUpdatedAvailable = useAppStore((state) => state.doctorUpdatedAvailable);
  const loadDoctor = useAppStore((state) => state.loadDoctor);

  useEffect(() => {
    if (open && doctor === null) {
      void loadDoctor();
    }
  }, [open, doctor, loadDoctor]);

  const reports = doctor ?? [];
  const summary = summarize(reports);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>诊断</DialogTitle>
          <DialogDescription>
            检查工具安装、配置文件可读可写可解析、存储权限与漂移状态。
          </DialogDescription>
        </DialogHeader>

        {doctorLoading && reports.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在检查…</p>
        ) : null}
        {doctorError ? <p className="text-sm text-destructive">{doctorError}</p> : null}

        {reports.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {summary.ok > 0 ? <Badge variant="secondary">{summary.ok} 项正常</Badge> : null}
              {summary.warn > 0 ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 text-amber-700 dark:text-amber-300"
                >
                  {summary.warn} 项警告
                </Badge>
              ) : null}
              {summary.error > 0 ? (
                <Badge variant="destructive">{summary.error} 项错误</Badge>
              ) : null}
              {summary.unknown > 0 ? (
                <Badge variant="outline">{summary.unknown} 项未知</Badge>
              ) : null}
              {doctorUpdatedAvailable ? (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="size-3.5" />
                  有新版本可用
                </span>
              ) : null}
            </div>

            {reports.map((report) => (
              <section key={report.harness}>
                <h3 className="mb-2 text-sm font-semibold">
                  {harnessLabel(report.harness)}
                  <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                    {report.harness}
                  </span>
                </h3>
                <CheckList checks={report.checks} />
              </section>
            ))}
          </>
        ) : null}
        {reports.length === 0 && !doctorLoading && !doctorError ? (
          <p className="py-6 text-center text-sm text-muted-foreground">尚未运行诊断</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={doctorLoading} onClick={() => void loadDoctor()}>
            <RefreshCcw className={doctorLoading ? 'animate-spin' : undefined} />
            重新诊断
          </Button>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckList({ checks }: { checks: DoctorCheck[] }) {
  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">没有可检查的项目</p>;
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
              <p className="text-sm leading-relaxed">{check.label}</p>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {STATUS_LABEL[check.status]}
              </span>
            </div>
            {check.detail !== undefined ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {formatDetail(check.detail)}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function harnessLabel(harness: string): string {
  const known: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    kimi: 'Kimi Code',
    pi: 'Pi',
    dsh: 'DeepSeek Harness',
  };
  return known[harness] ?? harness;
}

type Summary = { ok: number; warn: number; error: number; unknown: number };

function summarize(reports: DoctorReport[]): Summary {
  const summary: Summary = { ok: 0, warn: 0, error: 0, unknown: 0 };
  for (const report of reports) {
    for (const check of report.checks) {
      summary[check.status]++;
    }
  }
  return summary;
}
