import {
  type FavoritePlanRequest,
  type HarnessId,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { ArrowLeft, ArrowRight, Check, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { PreviewTabs } from './preview-tabs';
import { ToolSelection } from './tool-selection';

export function ModelFavoriteApplyDialog({
  favorite,
  onClose,
}: {
  favorite: ModelFavorite;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const plan = useAppStore((state) => state.favoritePlan);
  const operation = useAppStore((state) => state.favoriteOperation);
  const history = useAppStore((state) => state.favoriteOperationHistory);
  const [previousRequests] = useState(() => new Set(history.map((entry) => entry.requestId)));
  const makePlan = useAppStore((state) => state.planFavorite);
  const apply = useAppStore((state) => state.applyFavorite);
  const clear = useAppStore((state) => state.clearFavoritePlan);
  const targets = useAppStore((state) => state.favoriteTargets[favorite.id]);
  const loadTargets = useAppStore((state) => state.loadFavoriteTargets);
  const [items, setItems] = useState<FavoritePlanRequest['items']>([]);
  const [mode, setMode] = useState<'save' | 'activate'>('save');
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void loadTargets(favorite.id).catch((cause) => setError(lineText(t, errorLine(cause))));
  }, [favorite.id, loadTargets, t]);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  const change = (harness: HarnessId, patch: Partial<FavoritePlanRequest['items'][number]>) => {
    clear();
    setItems(items.map((item) => (item.harness === harness ? { ...item, ...patch } : item)));
  };
  const preview = async (selection = items) => {
    setRequestId(crypto.randomUUID());
    await makePlan({
      favoriteId: favorite.id,
      expectedRevision: favorite.revision,
      items: selection,
    });
    setStep(1);
  };
  const failed = operation?.items.some(
    (item) => item.status === 'failed' || item.status === 'skipped',
  );
  const complete = !!operation && !failed;
  const blocked = plan?.items.some((item) => item.projection.blockers.length > 0);
  const close = () => {
    if (!busy) {
      clear();
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex h-[min(820px,92dvh)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b px-6 pb-5 pt-6 text-left sm:px-8">
          <div
            className="mb-4 flex items-center gap-2 pr-8 text-xs font-medium text-muted-foreground"
            aria-label={t('favorites.workflow')}
          >
            <span
              className={cn('flex items-center gap-2', step === 0 && 'text-primary')}
              aria-current={step === 0 ? 'step' : undefined}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                {step === 1 ? <Check className="size-3.5" /> : '1'}
              </span>
              {t('favorites.chooseTools')}
            </span>
            <span className="h-px w-8 bg-border" />
            <span
              className={cn('flex items-center gap-2', step === 1 && 'text-primary')}
              aria-current={step === 1 ? 'step' : undefined}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                2
              </span>
              {t('favorites.reviewChanges')}
            </span>
          </div>
          <DialogTitle ref={title} tabIndex={-1} className="text-xl outline-none">
            {t(step === 0 ? 'favorites.configure' : 'favorites.reviewChanges')}
          </DialogTitle>
          <DialogDescription>
            {favorite.name} · {t(step === 0 ? 'favorites.chooseHint' : 'favorites.reviewHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className="flex h-full w-[200%] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(${step === 1 ? '-50%' : '0'})` }}
          >
            <section
              aria-label={t('favorites.chooseTools')}
              aria-hidden={step !== 0}
              inert={step !== 0 || busy}
              className="h-full w-1/2 shrink-0 space-y-5 overflow-y-auto p-6 sm:px-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">{t('favorites.targetTools')}</p>
                <RadioGroup
                  aria-label={t('favorites.mode')}
                  className="flex flex-wrap items-center gap-x-6 gap-y-3"
                  value={mode}
                  onValueChange={(value) => {
                    const next = value === 'activate' ? 'activate' : 'save';
                    setMode(next);
                    clear();
                    setItems(items.map((item) => ({ ...item, mode: next })));
                  }}
                >
                  {(['save', 'activate'] as const).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2.5 py-2 text-sm font-medium"
                      htmlFor={`favorite-mode-${value}`}
                    >
                      <RadioGroupItem value={value} id={`favorite-mode-${value}`} />
                      {t(`favorites.modeLabel.${value}`)}
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <ToolSelection
                favorite={favorite}
                items={items}
                setItems={setItems}
                mode={mode}
                plan={plan}
                targets={targets}
                clear={clear}
                change={change}
              />
            </section>
            <section
              aria-label={t('favorites.reviewChanges')}
              aria-hidden={step !== 1}
              inert={step !== 1}
              className="flex h-full w-1/2 shrink-0 flex-col gap-4 overflow-hidden bg-muted/20 p-6 sm:px-8"
            >
              {plan ? (
                <>
                  <p className="shrink-0 text-sm font-medium">
                    {t('favorites.batchSummary', {
                      count: plan.items.length,
                      activate: plan.items.filter((item) => item.mode === 'activate').length,
                      files: plan.items.reduce(
                        (sum, item) => sum + item.nativeFiles.filter((file) => file.changed).length,
                        0,
                      ),
                    })}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="size-4 shrink-0" />
                    {t('favorites.autoBackupNotice')}
                  </p>
                  <PreviewTabs
                    key={plan.id}
                    items={plan.items}
                    history={history.filter((entry) => !previousRequests.has(entry.requestId))}
                  />
                </>
              ) : null}
            </section>
          </div>
        </div>
        <div className="shrink-0 space-y-3 border-t bg-card px-6 py-4 sm:px-8">
          {error ? <Alert>{error}</Alert> : null}
          {step === 1 && blocked ? (
            <Alert variant="warning">{t('favorites.resolveBeforeApply')}</Alert>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            {step === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('favorites.selectedCount', { count: items.length })}
              </p>
            ) : (
              <Button
                variant="outline"
                disabled={busy || !!operation}
                onClick={() => {
                  setError('');
                  setStep(0);
                }}
              >
                <ArrowLeft />
                {t('favorites.backToSelection')}
              </Button>
            )}
            {step === 0 ? (
              <Button
                disabled={busy || !items.length || items.some((item) => !item.connectionId)}
                onClick={() => void run(() => preview())}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {t('favorites.preview')}
                <ArrowRight />
              </Button>
            ) : complete ? (
              <Button onClick={close}>
                <Check />
                {t('favorites.done')}
              </Button>
            ) : failed ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const remaining = items.filter((item) =>
                      operation?.items.some(
                        (result) =>
                          result.harness === item.harness &&
                          (result.status === 'failed' || result.status === 'skipped'),
                      ),
                    );
                    setItems(remaining);
                    await preview(remaining);
                  })
                }
              >
                {t('favorites.retryFailed')}
              </Button>
            ) : (
              <Button
                disabled={busy || !plan || !!operation || blocked}
                onClick={() => void run(() => apply(requestId))}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t(
                  mode === 'activate'
                    ? 'favorites.confirmBatchActivate'
                    : 'favorites.confirmBatchSave',
                  { count: plan?.items.length ?? 0 },
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
