import { type BackupDetail, HARNESS_LABELS, type HarnessId } from '@seaveyon/harness-switch-shared';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfigDiffs } from '@/components/config-diff';
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

type BackupPanelProps = {
  harnessId: HarnessId;
};

export function BackupPanel({ harnessId }: BackupPanelProps) {
  const backups = useAppStore((state) => state.backups);
  const loadBackups = useAppStore((state) => state.loadBackups);
  const loadBackupDetail = useAppStore((state) => state.loadBackupDetail);
  const restoreBackup = useAppStore((state) => state.restoreBackup);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BackupDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const items = backups.filter((item) => item.harness === harnessId);
  const pending = backups.find((item) => item.id === pendingId) ?? null;
  const label = HARNESS_LABELS[harnessId];

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  useEffect(() => {
    setOpen(false);
    setPendingId(null);
  }, [harnessId]);

  useEffect(() => {
    if (!pendingId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void loadBackupDetail(pendingId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : '加载差异失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingId, loadBackupDetail]);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <History />
        配置历史
        {items.length > 0 ? <Badge variant="secondary">{items.length}</Badge> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{label} 配置历史</DialogTitle>
            <DialogDescription>
              每次写入前都会把原文件快照到数据目录，保留最近 10
              份。这里只显示当前工具的历史；与磁盘一致的条目会标成「当前」。
            </DialogDescription>
          </DialogHeader>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有历史快照</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {items.map((backup) => (
                <li key={backup.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">{backup.profile}</p>
                      {backup.current ? <Badge>当前</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatBackupTime(backup.createdAt)} · {backup.files.length} 个文件
                      {backup.files.some((file) => !file.existed) ? ' · 含删除' : ''}
                    </p>
                  </div>
                  {backup.current ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setPendingId(backup.id)}
                    >
                      恢复
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={pending !== null} onOpenChange={(next) => !next && setPendingId(null)}>
        <DialogContent className="flex max-h-[85vh] w-[min(64rem,calc(100vw-2rem))] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>恢复这份历史？</DialogTitle>
            <DialogDescription>
              红是当前将丢失的内容，绿是恢复后的内容。确认后会按历史快照覆盖磁盘文件，harness-switch
              记录的「当前激活」不会随之回退。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">正在对比差异…</p>
            ) : null}
            {detailError ? (
              <p className="py-8 text-center text-sm text-destructive">{detailError}</p>
            ) : null}
            {detail ? <ConfigDiffs files={detail.files} /> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingId(null)}>
              取消
            </Button>
            <Button
              disabled={detailLoading || detailError !== null || detail === null}
              onClick={() => {
                if (pendingId) {
                  void restoreBackup(pendingId).then(() => {
                    setPendingId(null);
                    setOpen(false);
                  });
                }
              }}
            >
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBackupTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
