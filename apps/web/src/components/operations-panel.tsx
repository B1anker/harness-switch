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
 * Right-column card: durable write receipts for the selected harness.
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

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]">
      <div className="flex items-center gap-2">
        <History className="size-4 text-primary" />
        <h3 className="font-semibold">{t('operations.title')}</h3>
        <span className="ml-auto">
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

      <div className="mt-4">
        {operationsError ? (
          <p className="text-sm text-destructive">{lineText(t, operationsError)}</p>
        ) : operations === null || operationsLoading ? (
          <p className="text-sm text-muted-foreground">{t('operations.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('operations.empty')}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('operations.count', { count: items.length })}
          </p>
        )}
      </div>

      <Button
        className="mt-4 w-full"
        size="sm"
        variant="outline"
        disabled={operations === null}
        onClick={() => setOpen(true)}
      >
        {t('operations.viewDetails')}
      </Button>

      <OperationsDialog harnessId={harness.id} open={open} onOpenChange={setOpen} />
    </section>
  );
}
