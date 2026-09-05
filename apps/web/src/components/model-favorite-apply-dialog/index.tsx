import {
  type FavoritePlanRequest,
  type HarnessId,
  type HarnessSummary,
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
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { PreviewTabs } from './preview-tabs';
import { QuickPreview } from './quick-preview';
import { ToolSelection } from './tool-selection';

export function ModelFavoriteApplyDialog({
  favorite,
  onClose,
  initialItems = [],
  initialMode = 'save',
  initialPreview = false,
  onApplied,
  quickHarness,
}: {
  favorite: ModelFavorite;
  onClose(): void;
  initialItems?: FavoritePlanRequest['items'];
  initialMode?: 'save' | 'activate';
  initialPreview?: boolean;
  onApplied?(): void;
  quickHarness?: HarnessSummary;
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
  const [items, setItems] = useState<FavoritePlanRequest['items']>(initialItems);
  const [mode, setMode] = useState<'save' | 'activate'>(initialMode);
  const [step, setStep] = useState<0 | 1>(initialPreview ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewTab, setReviewTab] = useState('route');
  const [channel, setChannel] = useState('');
  const [quickReady, setQuickReady] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const connections = quickHarness ? compatibleConnections(favorite, quickHarness.id, targets) : [];
  const selectedChannel =
    channel ||
    (quickHarness
      ? favoriteSelection(favorite, quickHarness, targets, 'activate').connectionId
      : '');
  const connection = connections.find((entry) => entry.id === selectedChannel);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const title = useRef<HTMLHeadingElement>(null);
  const applying = useRef(false);
  useEffect(() => {
    void loadTargets(favorite.id).catch((cause) => setError(lineText(t, errorLine(cause))));
  }, [favorite.id, loadTargets, t]);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (!quickHarness || !selectedChannel || applying.current) {
      return;
    }
    let active = true;
    clear();
    setQuickReady(false);
    setError('');
    const selection = [
      {
        ...favoriteSelection(favorite, quickHarness, targets, 'activate'),
        connectionId: selectedChannel,
      },
    ];
    setItems(selection);
    setRequestId(crypto.randomUUID());
    void makePlan({
      favoriteId: favorite.id,
      expectedRevision: favorite.revision,
      items: selection,
    })
      .then(() => {
        if (active) {
          setQuickReady(true);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(lineText(t, errorLine(cause)));
        }
      });
    return () => {
      active = false;
    };
  }, [quickHarness, selectedChannel, favorite, targets, clear, makePlan, t, previewAttempt]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const applyAndClose = async () => {
    applying.current = true;
    const succeeded = await run(() => apply(requestId));
    if (succeeded) {
      clear();
      onApplied?.();
      onClose();
    } else {
      applying.current = false;
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
        style={{
          height: quickHarness && reviewTab === 'route' ? 'min(580px, 90dvh)' : 'min(820px, 90dvh)',
        }}
        className="flex h-[min(720px,90dvh)] max-w-4xl flex-col gap-0 overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b px-6 pb-5 pt-6 text-left sm:px-8">
          {!quickHarness ? (
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
          ) : null}
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
              inert={step !== 1 || busy}
              className="flex h-full w-1/2 shrink-0 flex-col gap-4 overflow-hidden bg-muted/20 p-6 sm:px-8"
            >
              {quickHarness ? (
                <QuickPreview
                  connections={connections}
                  connection={connection}
                  selectedChannel={selectedChannel}
                  setChannel={setChannel}
                  targetsLoaded={!!targets}
                  reviewTab={reviewTab}
                  setReviewTab={setReviewTab}
                  quickHarness={quickHarness}
                  templateName={favorite.name}
                  quickReady={quickReady}
                  plan={plan}
                />
              ) : plan ? (
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
          {error ? (
            <Alert>
              {error}
              {quickHarness && !quickReady ? (
                <Button variant="link" onClick={() => setPreviewAttempt((value) => value + 1)}>
                  {t('activate.retryPreview')}
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {step === 1 && blocked ? (
            <Alert variant="warning">{t('favorites.resolveBeforeApply')}</Alert>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            {quickHarness ? (
              <Button variant="outline" disabled={busy} onClick={close}>
                {t('common.cancel')}
              </Button>
            ) : step === 0 ? (
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
                disabled={
                  busy || !plan || !!operation || blocked || (!!quickHarness && !quickReady)
                }
                onClick={() => void applyAndClose()}
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
