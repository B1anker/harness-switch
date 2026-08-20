import type { DriftFileState, DriftStatus, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { useMemo, useState } from 'react';
import { ConfigDiffs } from '@/components/config-diff';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { useAppStore } from '@/stores/app-store';

type DriftDialogProps = {
  harness: HarnessSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const DRIFT_STATUS_LABEL: Record<DriftStatus, string> = {
  'in-sync': '一致',
  drifted: '已修改',
  missing: '缺失',
  invalid: '无法解析',
  unknown: '未知',
};

/** Badge styling: in-sync is calm, drifted/missing/invalid stand out. */
export function driftStatusClasses(status: DriftStatus): string {
  switch (status) {
    case 'in-sync':
      return 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'drifted':
      return 'border-amber-500/30 text-amber-700 dark:text-amber-300';
    case 'missing':
    case 'invalid':
      return 'border-transparent bg-destructive/15 text-destructive';
    default:
      return '';
  }
}

/**
 * Drift: compares what the active profile would render against what is on disk.
 * 重新应用 writes the expected content back (with a backup first); 采纳现场配置
 * reads the live files back into the profile store instead.
 */
export function DriftDialog({ harness, open, onOpenChange }: DriftDialogProps) {
  const drift = useAppStore((state) => state.drift);
  const driftLoading = useAppStore((state) => state.driftLoading);
  const reapplyDrift = useAppStore((state) => state.reapplyDrift);
  const adoptDrift = useAppStore((state) => state.adoptDrift);
  const [confirm, setConfirm] = useState<'reapply' | 'adopt' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = useMemo(
    () => drift?.find((item) => item.harness === harness.id) ?? null,
    [drift, harness.id],
  );

  const blockedFiles = report?.files.filter((file) => file.status !== 'in-sync') ?? [];
  const active = report?.active === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(64rem,calc(100vw-2rem))] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{harness.label} 配置漂移</DialogTitle>
          <DialogDescription>
            {active ? '红色是磁盘现状，绿色是按激活配置应写入的内容。' : '该工具未激活任何配置。'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {driftLoading && report === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">正在检查漂移…</p>
          ) : null}
          {report === null && !driftLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无漂移数据。</p>
          ) : null}
          {report && !active ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              未激活任何配置，没有可对比的内容。
            </p>
          ) : null}
          {report && active ? (
            <div className="space-y-3">
              {blockedFiles.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  所有文件与激活配置一致。
                </p>
              ) : (
                blockedFiles.map((file) => <DriftFileRow key={file.key} file={file} />)
              )}
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={report === null || !active}
            onClick={() => setConfirm('adopt')}
          >
            采纳现场配置
          </Button>
          <Button disabled={report === null || !active} onClick={() => setConfirm('reapply')}>
            重新应用
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirm === 'reapply'} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新应用激活配置？</AlertDialogTitle>
            <AlertDialogDescription>
              将按激活配置重新写入 {harness.label}{' '}
              的原生配置文件，覆盖磁盘上的现场修改。写入前会自动备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null);
                setError(null);
                void reapplyDrift(harness.id)
                  .then(() => onOpenChange(false))
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : '重新应用失败');
                  });
              }}
            >
              确认重新应用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === 'adopt'} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>采纳现场配置？</AlertDialogTitle>
            <AlertDialogDescription>
              将把磁盘上的当前内容回填进配置档案，之后的写入会以现场为准。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null);
                setError(null);
                void adoptDrift(harness.id)
                  .then(() => onOpenChange(false))
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : '采纳失败');
                  });
              }}
            >
              确认采纳
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function DriftFileRow({ file }: { file: DriftFileState }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <Badge className={driftStatusClasses(file.status)}>{DRIFT_STATUS_LABEL[file.status]}</Badge>
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={file.path}>
          {file.path}
        </p>
      </div>
      <ConfigDiffs
        files={[
          {
            path: file.path,
            existed: file.currentContent !== null,
            content: file.expectedContent,
            currentContent: file.currentContent,
          },
        ]}
      />
    </div>
  );
}
