import type { FavoriteBackupEntry } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
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
  const [selected, setSelected] = useState<FavoriteBackupEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('favorites.backups')}</DialogTitle>
          <DialogDescription>{t('favorites.backupHint')}</DialogDescription>
        </DialogHeader>
        <Button disabled={busy} onClick={() => void run(create, t('favorites.backupCreated'))}>
          {t('favorites.backupNow')}
        </Button>
        {notice ? <p role="status">{notice}</p> : null}
        {selected ? (
          <section className="space-y-3 rounded-xl border border-amber-500 p-4">
            <p className="font-medium">{new Date(selected.createdAt).toLocaleString()}</p>
            <p>{t('favorites.restoreScope')}</p>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() => void run(() => restore(selected.id), t('favorites.backupRestored'))}
              >
                {t('favorites.restoreConfirm')}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>
                {t('favorites.cancel')}
              </Button>
            </div>
          </section>
        ) : null}
        {!backups.length ? <p>{t('favorites.backupEmpty')}</p> : null}
        {backups.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div>
              <p>{new Date(entry.createdAt).toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">
                {t(`favorites.backupReason.${entry.reason}`)}
              </p>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => setSelected(entry)}>
              {t('favorites.restore')}
            </Button>
          </div>
        ))}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
