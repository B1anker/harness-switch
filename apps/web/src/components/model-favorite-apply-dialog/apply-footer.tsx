import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import type { useApplyWorkflow } from './use-apply-workflow';

export function ApplyFooter({
  flow,
  favoriteId,
  quick,
  blocked,
  onEditConnections,
}: {
  flow: ReturnType<typeof useApplyWorkflow>;
  favoriteId: string;
  quick: boolean;
  blocked: boolean;
  onEditConnections?(): void;
}) {
  const { t } = useTranslation();
  const { step, busy, plan, items } = flow;
  return (
    <div className="shrink-0 space-y-3 border-t bg-card px-6 py-4 sm:px-8">
      {flow.error ? (
        <Alert>
          {flow.error}
          {!flow.targets ? (
            <Button
              variant="link"
              disabled={busy}
              onClick={() => void flow.run(() => flow.loadTargets(favoriteId))}
            >
              {t('favorites.retryTargets')}
            </Button>
          ) : quick && !flow.quickReady && !flow.uncertain && !flow.needsPreview && step !== 2 ? (
            <Button variant="link" onClick={flow.refreshQuickPreview}>
              {t('activate.retryPreview')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {flow.uncertain ? <Alert variant="warning">{t('favorites.unconfirmedResult')}</Alert> : null}
      {step === 1 && blocked ? (
        <Alert variant="warning">{t('favorites.resolveBeforeApply')}</Alert>
      ) : null}
      {quick && step === 1 && !!flow.targets && !flow.connections.length && onEditConnections ? (
        <Button variant="outline" onClick={onEditConnections}>
          {t('favorites.editForCompatibility')}
        </Button>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between [&>button]:h-auto [&>button]:min-h-10 [&>button]:max-w-full [&>button]:whitespace-normal">
        {step === 2 && flow.failed ? (
          <Button variant="outline" disabled={busy} onClick={flow.close}>
            {t('favorites.closeResults')}
          </Button>
        ) : step === 2 ? (
          <span />
        ) : step === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('favorites.selectedCount', { count: items.length })}
          </p>
        ) : quick && !blocked ? (
          <Button variant="outline" disabled={busy} onClick={flow.close}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy || flow.uncertain}
            onClick={() => {
              flow.setError('');
              flow.setStep(0);
            }}
          >
            <ArrowLeft />
            {t('favorites.backToSelection')}
          </Button>
        )}
        {step === 0 ? (
          <Button
            disabled={busy || !items.length || items.some((item) => !item.connectionId)}
            onClick={() => void flow.run(() => flow.preview())}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t('favorites.preview')}
            <ArrowRight />
          </Button>
        ) : step === 2 ? (
          flow.failed ? (
            <Button disabled={busy} onClick={() => void flow.retry()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t('favorites.retryFailed')}
            </Button>
          ) : (
            <Button onClick={flow.close}>
              <Check />
              {t('favorites.done')}
            </Button>
          )
        ) : flow.needsPreview ? (
          <Button disabled={busy} onClick={() => void flow.run(() => flow.preview())}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t('favorites.refreshPreview')}
          </Button>
        ) : (
          <Button
            disabled={busy || !plan || blocked || (quick && !flow.quickReady)}
            onClick={() => void flow.submit()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {t(
              flow.uncertain
                ? 'favorites.checkResult'
                : flow.mode === 'activate'
                  ? 'favorites.confirmBatchActivate'
                  : 'favorites.confirmBatchSave',
              { count: plan?.items.length ?? 0 },
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
