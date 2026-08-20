import type { DriftSummary, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { GitCompareArrows, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DRIFT_STATUS_LABEL, DriftDialog, driftStatusClasses } from '@/components/drift-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';

type DriftPanelProps = {
  harness: HarnessSummary;
};

/**
 * Right-column card: how far the live files have drifted from what the active
 * profile would render. Clicking 查看差异 opens the per-file diff and the
 * reapply / adopt actions.
 */
export function DriftPanel({ harness }: DriftPanelProps) {
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
        <h3 className="font-semibold">配置漂移</h3>
        <span className="ml-auto">
          <Button
            size="icon"
            variant="ghost"
            aria-label="重新检查漂移"
            onClick={() => void loadDrift()}
          >
            <RefreshCcw className={driftLoading ? 'animate-spin' : undefined} />
          </Button>
        </span>
      </div>

      <div className="mt-4">
        {driftError ? (
          <p className="text-sm text-destructive">{driftError}</p>
        ) : report === null ? (
          <p className="text-sm text-muted-foreground">正在检查漂移…</p>
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
                {DRIFT_STATUS_LABEL[file.status]}
              </span>
            </li>
          ))}
          {changed.length > 3 ? (
            <li className="pl-3.5 text-xs text-muted-foreground">
              还有 {changed.length - 3} 个文件…
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
        查看差异
      </Button>

      <DriftDialog harness={harness} open={open} onOpenChange={setOpen} />
    </section>
  );
}

function DriftBadge({ report }: { report: DriftSummary }) {
  if (!report.active) {
    return <Badge variant="secondary">未激活</Badge>;
  }
  if (report.status === 'in-sync') {
    return <Badge variant="secondary">无漂移</Badge>;
  }
  if (report.status === 'drifted') {
    const count = report.files.filter((file) => file.status !== 'in-sync').length;
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-300">
        {count} 个文件不一致
      </Badge>
    );
  }
  return (
    <Badge className={driftStatusClasses(report.status)}>{DRIFT_STATUS_LABEL[report.status]}</Badge>
  );
}
