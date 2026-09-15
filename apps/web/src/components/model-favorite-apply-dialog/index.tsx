import { Check, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ApplyFooter } from './apply-footer';
import { OperationResult } from './operation-result';
import { PreviewTabs } from './preview-tabs';
import { QuickPreview } from './quick-preview';
import { SchemeApply } from './scheme-apply';
import { ToolSelection } from './tool-selection';
import { type ApplyDialogProps, useApplyWorkflow } from './use-apply-workflow';

export function ModelFavoriteApplyDialog(props: ApplyDialogProps) {
  if (
    (!props.quickHarness || ['kimi', 'dsh'].includes(props.quickHarness.id)) &&
    (!props.initialItems?.length ||
      props.initialItems.every((item) => ['kimi', 'dsh'].includes(item.harness))) &&
    (props.favorite.defaultConnectionId ||
      props.favorite.toolBindings ||
      props.favorite.connections.some((entry) => entry.groupId))
  ) {
    return (
      <SchemeApply props={props} renderSingle={(next) => <SingleFavoriteApplyDialog {...next} />} />
    );
  }
  return <SingleFavoriteApplyDialog {...props} />;
}

function SingleFavoriteApplyDialog(props: ApplyDialogProps) {
  const { favorite, quickHarness, onEditConnections } = props;
  const { t } = useTranslation();
  const flow = useApplyWorkflow(props);
  const { step, plan, busy, mode, items } = flow;
  const [reviewTab, setReviewTab] = useState('route');
  const title = useRef<HTMLHeadingElement>(null);
  const blocked = plan?.items.some((item) => item.projection.blockers.length > 0);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);
  const editConnections = onEditConnections
    ? () => {
        flow.close();
        onEditConnections();
      }
    : undefined;
  return (
    <Dialog open onOpenChange={(open) => !open && flow.close()}>
      <DialogContent
        style={{
          height:
            step === 2
              ? `min(${Math.max(400, 270 + flow.results.length * 150)}px, 90dvh)`
              : 'min(820px, 90dvh)',
        }}
        className="flex h-[min(720px,90dvh)] max-w-4xl flex-col gap-0 overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b px-6 pb-5 pt-6 text-left sm:px-8">
          {!quickHarness ? (
            <div
              className="mb-4 flex flex-wrap items-center gap-2 pr-8 text-xs font-medium text-muted-foreground"
              aria-label={t('favorites.workflow')}
            >
              {(
                ['favorites.chooseTools', 'favorites.reviewChanges', 'favorites.results'] as const
              ).map((label, index) => (
                <span
                  key={label}
                  className={cn('flex items-center gap-2', step === index && 'text-primary')}
                  aria-current={step === index ? 'step' : undefined}
                >
                  {index > 0 ? <span className="h-px w-4 bg-border" /> : null}
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                    {step > index ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  {t(label)}
                </span>
              ))}
            </div>
          ) : null}
          <DialogTitle ref={title} tabIndex={-1} className="text-xl outline-none">
            {t(
              step === 2
                ? flow.failed
                  ? 'favorites.resultTitlePartial'
                  : 'favorites.resultTitleComplete'
                : step === 0
                  ? 'favorites.configure'
                  : 'favorites.reviewChanges',
            )}
          </DialogTitle>
          <DialogDescription>
            {favorite.name} ·{' '}
            {t(
              step === 2
                ? 'favorites.resultHint'
                : step === 0
                  ? 'favorites.chooseHint'
                  : 'favorites.reviewHint',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {step === 2 ? (
            <OperationResult results={flow.results} />
          ) : (
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
                      flow.setMode(next);
                      flow.clear();
                      flow.setItems(items.map((item) => ({ ...item, mode: next })));
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
                <p className="text-sm text-muted-foreground">{t(`favorites.modeHint.${mode}`)}</p>
                <ToolSelection
                  favorite={favorite}
                  items={items}
                  setItems={flow.setItems}
                  mode={mode}
                  plan={plan}
                  targets={flow.targets}
                  clear={flow.clear}
                  change={flow.change}
                  completedHarnesses={flow.completedHarnesses}
                  onlyHarness={quickHarness?.id}
                  onEditConnections={editConnections}
                />
              </section>
              <section
                aria-label={t('favorites.reviewChanges')}
                aria-hidden={step !== 1}
                inert={step !== 1 || busy || flow.uncertain}
                className="flex h-full w-1/2 shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain bg-muted/20 p-6 sm:px-8"
              >
                <p className="shrink-0 text-sm text-muted-foreground">
                  {t(`favorites.modeHint.${mode}`)}
                </p>
                {quickHarness ? (
                  <QuickPreview
                    connections={flow.connections}
                    connection={flow.connection}
                    selectedChannel={flow.selectedChannel}
                    setChannel={flow.changeChannel}
                    targetsLoaded={!!flow.targets}
                    reviewTab={reviewTab}
                    setReviewTab={setReviewTab}
                    quickHarness={quickHarness}
                    templateName={favorite.name}
                    quickReady={flow.quickReady}
                    plan={plan}
                  />
                ) : plan ? (
                  <>
                    <p className="shrink-0 text-sm font-medium">
                      {t('favorites.batchSummary', {
                        count: plan.items.length,
                        activate: plan.items.filter((item) => item.mode === 'activate').length,
                        files: plan.items.reduce(
                          (sum, item) =>
                            sum + item.nativeFiles.filter((file) => file.changed).length,
                          0,
                        ),
                      })}
                    </p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="size-4 shrink-0" />
                      {t('favorites.autoBackupNotice')}
                    </p>
                    <PreviewTabs key={plan.id} items={plan.items} />
                  </>
                ) : null}
              </section>
            </div>
          )}
        </div>
        <ApplyFooter
          flow={flow}
          favoriteId={favorite.id}
          quick={!!quickHarness}
          blocked={!!blocked}
          onEditConnections={editConnections}
        />
      </DialogContent>
    </Dialog>
  );
}
