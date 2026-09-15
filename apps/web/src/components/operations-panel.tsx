import type { HarnessSummary } from '@seaveyon/harness-switch-shared';
import { History, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OperationsDialog } from '@/components/operations-dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type OperationsPanelProps = {
  harness: HarnessSummary;
};

/**
 * Durable write receipts for the selected harness, as a row inside the tool details.
 * Nothing is rendered until the first write has happened: a receipt log is a concept the
 * user only needs once there is something in it.
 */
export function OperationsPanel({ harness }: OperationsPanelProps) {
  const { t } = useTranslation();
  const operations = useAppStore((state) => state.operations);
  const operationsLoading = useAppStore((state) => state.operationsLoading);
  const operationsError = useAppStore((state) => state.operationsError);
  const loadOperations = useAppStore((state) => state.loadOperations);
  const [open, setOpen] = useState(false);

  const items = operations?.filter((item) => item.harness === harness.id) ?? [];

  useEffect(() => {
    void loadOperations(harness.id);
  }, [harness.id, loadOperations]);

  if (items.length === 0 && !operationsError) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <History className="size-4 text-primary" />
        <h4 className="text-sm font-semibold">{t('operations.title')}</h4>
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={operations === null}
            onClick={() => setOpen(true)}
          >
            {t('operations.viewDetails')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('operations.refresh')}
            onClick={() => void loadOperations(harness.id)}
          >
            <RefreshCcw className={operationsLoading ? 'animate-spin' : undefined} />
          </Button>
        </span>
      </div>
      <div className="mt-2">
        {operationsError ? (
          <p className="text-sm text-destructive">{lineText(t, operationsError)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('operations.count', { count: items.length })}
          </p>
        )}
      </div>
      <OperationsDialog harnessId={harness.id} open={open} onOpenChange={setOpen} />
    </div>
  );
}
