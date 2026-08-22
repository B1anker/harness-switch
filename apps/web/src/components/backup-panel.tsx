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
import { useI18n, useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type BackupPanelProps = {
  harnessId: HarnessId;
};

export function BackupPanel({ harnessId }: BackupPanelProps) {
  const { locale } = useI18n();
  const { t } = useTranslation();
  const backups = useAppStore((state) => state.backups);
  const loadBackups = useAppStore((state) => state.loadBackups);
  const loadBackupDetail = useAppStore((state) => state.loadBackupDetail);
  const restoreBackup = useAppStore((state) => state.restoreBackup);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BackupDetail | null>(null);
  const [detailError, setDetailError] = useState<MessageLine | null>(null);
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
          setDetailError(errorLineWith(error, 'backup.diffFailed'));
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
      <Button
        className="w-full justify-between"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <History />
        {t('backup.history')}
        {items.length > 0 ? <Badge variant="secondary">{items.length}</Badge> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('backup.historyTitle', { harness: label })}</DialogTitle>
            <DialogDescription>{t('backup.historyIntro')}</DialogDescription>
          </DialogHeader>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('backup.empty')}</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
              {items.map((backup) => (
                <li
                  key={backup.id}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">{backup.profile}</p>
                      {backup.current ? <Badge>{t('backup.currentBadge')}</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatBackupTime(backup.createdAt, locale)} ·{' '}
                      {t('backup.fileCount', { count: backup.files.length })}
                      {backup.files.some((file) => !file.existed)
                        ? ` · ${t('backup.withDeletions')}`
                        : ''}
                    </p>
                  </div>
                  {backup.current ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setPendingId(backup.id)}
                    >
                      {t('backup.restore')}
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
            <DialogTitle>{t('backup.restoreHistoryTitle')}</DialogTitle>
            <DialogDescription>{t('backup.restoreHistoryBody')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('backup.comparing')}
              </p>
            ) : null}
            {detailError ? (
              <p className="py-8 text-center text-sm text-destructive">
                {lineText(t, detailError)}
              </p>
            ) : null}
            {detail ? <ConfigDiffs files={detail.files} /> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingId(null)}>
              {t('common.cancel')}
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
              {t('backup.confirmRestore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBackupTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}
