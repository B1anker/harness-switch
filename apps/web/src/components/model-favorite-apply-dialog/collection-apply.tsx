import type { ToolModelsHarness, ToolModelsRequest } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { ModelsPreview } from '@/components/tool-models/preview';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import type { ApplyDialogProps } from './use-apply-workflow';

export function CollectionApply({
  harness,
  favorite,
  onApplied,
  onBusyChange,
  onClose,
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
    <div className="flex min-h-0 flex-1 flex-col">
      <fieldset
        disabled={busy || done}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4"
      >
        <p className="text-sm text-muted-foreground">{t('favorites.scheme.collectionApplyHint')}</p>
        <Disclosure title={t('favorites.scheme.selectedCount', { count: candidates.length })}>
          {candidates.map((entry) => (
            <p key={entry.id} className="break-all font-mono text-sm">
              {entry.label} / {entry.requestModelId}
            </p>
          ))}
        </Disclosure>
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
        {preview ? <ModelsPreview preview={preview} /> : null}
      </fieldset>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-6 py-4">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {t(done ? 'favorites.done' : 'common.cancel')}
        </Button>
        {done ? null : !preview ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !candidates.some((entry) => entry.id === defaultId)}
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
              disabled={busy || !candidates.some((entry) => entry.id === defaultId)}
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={clear}>
              {t('favorites.backToSelection')}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await apply(harness, preview.id);
                  setDone(true);
                  onApplied?.();
                })
              }
            >
              {t('toolModels.apply')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
