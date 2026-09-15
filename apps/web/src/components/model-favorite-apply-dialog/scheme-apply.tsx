import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';
import { CollectionApply } from './collection-apply';
import type { ApplyDialogProps } from './use-apply-workflow';

export function SchemeApply({
  props,
  renderSingle,
}: {
  props: ApplyDialogProps;
  renderSingle(props: ApplyDialogProps): ReactNode;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const [tool, setTool] = useState<HarnessId | ''>(
    props.quickHarness?.id ?? props.initialItems?.[0]?.harness ?? 'claude',
  );
  const [single, setSingle] = useState(false);
  const [mode, setMode] = useState(props.initialMode ?? 'save');
  const [busy, setBusy] = useState(false);
  if (single && tool) {
    return renderSingle({
      ...props,
      initialMode: mode,
      quickHarness: harnesses.find((entry) => entry.id === tool),
      initialItems: props.initialItems?.filter((entry) => entry.harness === tool),
      onClose: props.onClose,
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          props.onClose();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        style={{ height: tool === 'kimi' || tool === 'dsh' ? 'min(760px,90dvh)' : undefined }}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b p-6 pr-12">
          <DialogTitle>{t('favorites.configure')}</DialogTitle>
          <DialogDescription>{props.favorite.name}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="shrink-0 border-b px-6 py-3">
          <TabList
            idPrefix="scheme-apply-tools"
            label={t('favorites.targetTools')}
            items={harnesses.map((entry) => ({ id: entry.id }))}
            value={tool}
            onChange={(value) => setTool(value as HarnessId)}
            className="flex flex-wrap gap-2"
            tabClassName="px-3 py-2 text-sm"
          >
            {(item) => t(`favorites.scheme.tools.${item.id}`)}
          </TabList>
        </fieldset>
        <TabPanel
          idPrefix="scheme-apply-tools"
          value={tool}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tool === 'kimi' || tool === 'dsh' ? (
            <CollectionApply key={tool} harness={tool} onBusyChange={setBusy} {...props} />
          ) : tool ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-4 p-6">
                <p className="text-sm text-muted-foreground">
                  {t('favorites.scheme.reviewTool', { tool: t(`favorites.scheme.tools.${tool}`) })}
                </p>
                <RadioGroup
                  aria-label={t('favorites.mode')}
                  value={mode}
                  onValueChange={(value) => setMode(value === 'activate' ? 'activate' : 'save')}
                >
                  {(['save', 'activate'] as const).map((value) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={value} />
                      {t(`favorites.modeLabel.${value}`)}
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <div className="flex shrink-0 justify-between gap-3 border-t p-6">
                <Button variant="outline" onClick={props.onClose}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => setSingle(true)}>{t('favorites.reviewChanges')}</Button>
              </div>
            </div>
          ) : null}
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
}
