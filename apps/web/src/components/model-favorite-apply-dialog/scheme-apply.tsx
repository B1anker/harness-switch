import type {
  HarnessId,
  ToolModelsHarness,
  ToolModelsRequest,
} from '@seaveyon/harness-switch-shared';
import { type ReactNode, useEffect, useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { ModelsPreview } from '@/components/tool-models/preview';
import { Alert } from '@/components/ui/alert';
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
    props.quickHarness?.id ?? props.initialItems?.[0]?.harness ?? '',
  );
  const [single, setSingle] = useState(false);
  const [busy, setBusy] = useState(false);
  if (single && tool) {
    return renderSingle({
      ...props,
      quickHarness: harnesses.find((entry) => entry.id === tool),
      initialItems: props.initialItems?.filter((entry) => entry.harness === tool),
      onClose: props.quickHarness ? props.onClose : () => setSingle(false),
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
        className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden"
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
        <DialogHeader>
          <DialogTitle>{t('favorites.configure')}</DialogTitle>
          <DialogDescription>{props.favorite.name}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0 space-y-5 overflow-y-auto">
          <FavoriteSelect
            id="scheme-tool"
            label={t('favorites.targetTools')}
            value={tool}
            options={harnesses.map((entry) => ({
              value: entry.id,
              label: t(`favorites.scheme.tools.${entry.id}`),
            }))}
            onChange={(value) => setTool(value as HarnessId)}
          />
          {tool === 'kimi' || tool === 'dsh' ? (
            <CollectionApply key={tool} harness={tool} onBusyChange={setBusy} {...props} />
          ) : tool ? (
            <Button onClick={() => setSingle(true)}>{t('favorites.reviewChanges')}</Button>
          ) : null}
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}

function CollectionApply({
  harness,
  favorite,
  onApplied,
  onBusyChange,
}: ApplyDialogProps & { harness: ToolModelsHarness; onBusyChange(busy: boolean): void }) {
  const { t } = useTranslation();
  const load = useAppStore((state) => state.loadToolModels);
  const preview = useAppStore((state) => state.toolModelsPreview);
  const makePreview = useAppStore((state) => state.previewToolModels);
  const apply = useAppStore((state) => state.applyToolModels);
  const save = useAppStore((state) => state.saveToolModels);
  const clear = useAppStore((state) => state.clearToolModelsPreview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);
  const binding = favorite.toolBindings?.[harness];
  const candidates = favorite.connections.filter(
    (entry) => entry.requestModelId && (!binding?.modelIds || binding.modelIds.includes(entry.id)),
  );
  const [defaultId, setDefaultId] = useState(
    binding?.defaultModelId ?? favorite.defaultConnectionId ?? '',
  );
  useEffect(() => {
    clear();
    return clear;
  }, [clear]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  const prepare = async () => {
    await load(harness);
    const state = useAppStore
      .getState()
      .toolModels.find((entry) => entry.harness === harness)?.state;
    if (!state || useAppStore.getState().toolModelsError) {
      setError(t('toolModels.retry'));
      return;
    }
    // Applying one template keeps models managed by other templates or standalone profiles.
    const retained = state.draft.items.filter(
      (item) => item.source.kind !== 'favorite' || item.source.favoriteId !== favorite.id,
    );
    const items = candidates.map((entry) => {
      const existing = state.draft.items.find(
        (item) =>
          item.source.kind === 'favorite' &&
          item.source.favoriteId === favorite.id &&
          item.source.connectionId === entry.id,
      );
      return {
        id: existing?.id ?? entry.id,
        source: { kind: 'favorite' as const, favoriteId: favorite.id, connectionId: entry.id },
        factOverrides: {},
        preferenceOverrides: binding?.reasoningEffort
          ? { reasoningEffort: binding.reasoningEffort }
          : {},
      };
    });
    const request: ToolModelsRequest = {
      expectedRevision: state.revision,
      draft: {
        items: [...retained, ...items],
        defaultItemId: items.find((item) => item.source.connectionId === defaultId)?.id ?? null,
      },
    };
    return request;
  };
  return (
    <fieldset disabled={busy || done} className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">{t('favorites.scheme.collectionApplyHint')}</p>
      {candidates.map((entry) => (
        <p key={entry.id} className="break-all font-mono text-sm">
          {entry.label} / {entry.requestModelId}
        </p>
      ))}
      <FavoriteSelect
        id="scheme-apply-default"
        label={t('favorites.scheme.startModel')}
        value={defaultId}
        options={candidates.map((entry) => ({
          value: entry.id,
          label: `${entry.label} / ${entry.requestModelId}`,
        }))}
        onChange={(value) => {
          setDefaultId(value);
          setSaved(false);
          clear();
        }}
        error={
          !candidates.some((entry) => entry.id === defaultId)
            ? t('favorites.scheme.defaultIncompatible')
            : undefined
        }
      />
      {error ? <Alert>{error}</Alert> : null}
      <p role="status" className="min-h-5 text-sm">
        {busy
          ? t('toolModels.loading')
          : done
            ? t('toolModels.applied')
            : saved
              ? t('favorites.scheme.draftSaved')
              : ''}
      </p>
      {!preview ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!candidates.some((entry) => entry.id === defaultId)}
            onClick={() =>
              void run(async () => {
                const request = await prepare();
                if (request) {
                  await save(harness, request);
                  setSaved(true);
                }
              })
            }
          >
            {t('favorites.scheme.saveDraft')}
          </Button>
          <Button
            disabled={!candidates.some((entry) => entry.id === defaultId)}
            onClick={() =>
              void run(async () => {
                const request = await prepare();
                if (request) {
                  await makePreview(harness, request);
                }
              })
            }
          >
            {t('toolModels.preview')}
          </Button>
        </div>
      ) : (
        <ModelsPreview
          preview={preview}
          onApply={() =>
            void run(async () => {
              await apply(harness, preview.id);
              setDone(true);
              onApplied?.();
            })
          }
        />
      )}
    </fieldset>
  );
}
