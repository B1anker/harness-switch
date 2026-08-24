import type { HarnessId, OperationReceipt, OperationState } from '@seaveyon/harness-switch-shared';
import { HARNESS_LABELS } from '@seaveyon/harness-switch-shared';
import { Loader2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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

type OperationsDialogProps = {
  harnessId: HarnessId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Every operation leaves a durable record, which is what makes undo mean "revert the
 * whole switch" rather than "restore some files": the native config and the recorded
 * active profile go back together.
 */
export function OperationsDialog({ harnessId, open, onOpenChange }: OperationsDialogProps) {
  const { locale } = useI18n();
  const { t } = useTranslation();
  const operations = useAppStore((state) => state.operations);
  const loading = useAppStore((state) => state.operationsLoading);
  const loadError = useAppStore((state) => state.operationsError);
  const loadOperations = useAppStore((state) => state.loadOperations);
  const undoOperation = useAppStore((state) => state.undoOperation);
  const [pending, setPending] = useState<OperationReceipt | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);

  const items = operations?.filter((item) => item.harness === harnessId) ?? [];
  const label = HARNESS_LABELS[harnessId];

  useEffect(() => {
    if (open) {
      setError(null);
      void loadOperations(harnessId);
    }
  }, [open, harnessId, loadOperations]);

  async function confirmUndo(): Promise<void> {
    if (!pending) {
      return;
    }
    setUndoing(true);
    setError(null);
    try {
      await undoOperation(pending.id);
      setPending(null);
    } catch (caught) {
      setError(errorLineWith(caught, 'operations.undoFailed'));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[min(52rem,calc(100vw-2rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 space-y-1.5 px-6 pb-4 pt-6 pr-12">
            <DialogTitle>{t('operations.titleFor', { harness: label })}</DialogTitle>
            <DialogDescription>{t('operations.intro')}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">
            {loading && items.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('operations.loading')}
              </p>
            ) : null}
            {loadError ? (
              <p className="py-6 text-sm text-destructive">{lineText(t, loadError)}</p>
            ) : null}
            {!loading && items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('operations.empty')}
              </p>
            ) : null}
            {items.length > 0 ? (
              <ul className="divide-y rounded-xl border">
                {items.map((receipt) => (
                  <li key={receipt.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {t(`operations.kind.${receipt.kind}`)} · {receipt.profile}
                        </span>
                        <Badge variant={badgeVariant(receipt.state)}>
                          {t(`operations.state.${receipt.state}`)}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatTime(receipt.finishedAt ?? receipt.startedAt, locale)} ·{' '}
                        {t('operations.user', { user: receipt.user })} ·{' '}
                        {t('operations.fileCount', { count: receipt.files.length })}
                      </p>
                      {receipt.note ? (
                        <p className="truncate text-xs text-muted-foreground">{receipt.note}</p>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={!receipt.undoable}
                      onClick={() => setPending(receipt)}
                    >
                      <Undo2 />
                      {t('operations.undo')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 px-6 py-4">
            <Button onClick={() => onOpenChange(false)}>{t('operations.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pending !== null} onOpenChange={(next) => !next && setPending(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('operations.undoTitle')}</DialogTitle>
            <DialogDescription>
              {pending
                ? t('operations.undoBody', {
                    harness: HARNESS_LABELS[pending.harness] ?? pending.harness,
                    count: pending.files.length,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={undoing} onClick={() => void confirmUndo()}>
              {undoing ? <Loader2 className="animate-spin" /> : null}
              {t('operations.confirmUndo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function badgeVariant(state: OperationState): 'default' | 'secondary' | 'destructive' {
  if (state === 'degraded') {
    return 'destructive';
  }
  return state === 'committed' ? 'default' : 'secondary';
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}
