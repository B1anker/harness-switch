import type { FavoriteBackupEntry } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { BackupImpact } from '@/components/backup-impact';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function GlobalBackups({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const backups = useAppStore((state) => state.favoriteBackups);
  const load = useAppStore((state) => state.loadFavoriteBackups);
  const create = useAppStore((state) => state.createFavoriteBackup);
  const restore = useAppStore((state) => state.restoreFavoriteBackup);
  const preview = useAppStore((state) => state.favoriteBackupPreview);
  const inspect = useAppStore((state) => state.previewFavoriteBackup);
  const [selected, setSelected] = useState<FavoriteBackupEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inspectEntry = async (entry: FavoriteBackupEntry) => {
    setSelected(entry);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await inspect(entry.id);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  const description = (entry: FavoriteBackupEntry) =>
    entry.context
      ? t(`favorites.backupAction.${entry.context.action}`, {
          name: entry.context.name ?? '',
          tools:
            entry.context.tools?.map((tool) => t(`favorites.toolNames.${tool}`)).join('、') ?? '',
        })
      : t(`favorites.backupReason.${entry.reason}`);
  useEffect(() => {
    void load().catch((cause) => setError(lineText(t, errorLine(cause))));
  }, [load, t]);
  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setSelected(null);
      setNotice(message);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t(selected ? 'favorites.restoreReview' : 'favorites.backups')}</DialogTitle>
          <DialogDescription>
            {t(selected ? 'favorites.restoreReviewHint' : 'favorites.backupHint')}
          </DialogDescription>
        </DialogHeader>
        {!selected ? (
          <Button disabled={busy} onClick={() => void run(create, t('favorites.backupCreated'))}>
            {t('favorites.backupNow')}
          </Button>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {selected ? (
            <section className="space-y-3">
              <p className="font-medium">{new Date(selected.createdAt).toLocaleString()}</p>
              <p className="text-sm">{description(selected)}</p>
              <p className="rounded-lg bg-amber-500/10 p-3 text-sm">
                {t('favorites.restoreScope')}
              </p>
              {busy ? (
                <p role="status">{t('favorites.restoreChecking')}</p>
              ) : preview?.id === selected.id ? (
                <BackupImpact preview={preview} />
              ) : null}
            </section>
          ) : null}
          {!selected && !backups.length ? <p>{t('favorites.backupEmpty')}</p> : null}
          {!selected
            ? backups.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div>
                    <p>{new Date(entry.createdAt).toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">{description(entry)}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void inspectEntry(entry)}
                  >
                    {t('favorites.restore')}
                  </Button>
                </div>
              ))
            : null}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {selected ? (
          <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t pt-4">
            <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>
              {t('favorites.cancel')}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void inspectEntry(selected)}>
                {t('favorites.restoreRecheck')}
              </Button>
              <Button
                disabled={
                  busy ||
                  preview?.id !== selected.id ||
                  !preview.files.some((file) => file.action !== 'unchanged')
                }
                onClick={() =>
                  void run(
                    () => restore(selected.id, preview!.fingerprint),
                    t('favorites.backupRestored'),
                  )
                }
              >
                {t('favorites.restoreConfirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
