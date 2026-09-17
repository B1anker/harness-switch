import type { ToolModelsHarness, ToolModelsRequest } from '@seaveyon/harness-switch-shared';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { ModelsPreview } from '@/components/tool-models/preview';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { type ApplyMode, ModeRadio } from './mode-radio';
import type { ApplyDialogProps } from './use-apply-workflow';

/**
 * Applying a template to a tool that keeps a model collection (Kimi, DSH) writes every
 * selected model and picks the one the tool starts on. The pane still walks the same two
 * steps as the single-profile tools — choose, then review and confirm — so the dialog
 * reads the same whichever tab is open.
 */
export function CollectionApply({
  harness,
  favorite,
  mode,
  onModeChange,
  onApplied,
  onBusyChange,
  onClose,
}: ApplyDialogProps & {
  harness: ToolModelsHarness;
  mode: ApplyMode;
  onModeChange(mode: ApplyMode): void;
  onBusyChange(busy: boolean): void;
}) {
  const { t } = useTranslation();
  const load = useAppStore((state) => state.loadToolModels);
  const preview = useAppStore((state) => state.toolModelsPreview);
  const makePreview = useAppStore((state) => state.previewToolModels);
  const apply = useAppStore((state) => state.applyToolModels);
  const save = useAppStore((state) => state.saveToolModels);
  const clear = useAppStore((state) => state.clearToolModelsPreview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [request, setRequest] = useState<ToolModelsRequest | null>(null);
  const [done, setDone] = useState(false);
  const binding = favorite.toolBindings?.[harness];
  const candidates = favorite.connections.filter(
    (entry) => entry.requestModelId && (!binding?.modelIds || binding.modelIds.includes(entry.id)),
  );
  // A lone model needs no choice; several without a template default do.
  const [defaultId, setDefaultId] = useState(
    binding?.defaultModelId ??
      favorite.defaultConnectionId ??
      (candidates.length === 1 ? candidates[0]!.id : ''),
  );
  const chosen = candidates.find((entry) => entry.id === defaultId);
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
    const next: ToolModelsRequest = {
      expectedRevision: state.revision,
      draft: {
        items: [...retained, ...items],
        defaultItemId: items.find((item) => item.source.connectionId === defaultId)?.id ?? null,
      },
    };
    return next;
  };
  const review = () =>
    run(async () => {
      const next = await prepare();
      if (!next) {
        return;
      }
      setRequest(next);
      // Saving a draft leaves the tool's files alone, so there is nothing to diff.
      if (mode === 'activate') {
        await makePreview(harness, next);
      }
      setStep('review');
    });
  const confirm = () =>
    run(async () => {
      if (mode === 'activate') {
        if (!preview) {
          return;
        }
        await apply(harness, preview.id);
      } else {
        if (!request) {
          return;
        }
        await save(harness, request);
      }
      setDone(true);
      onApplied?.();
    });
  const back = () => {
    clear();
    setRequest(null);
    setError('');
    setStep('choose');
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <fieldset
        disabled={busy || done}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6"
      >
        {step === 'choose' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('favorites.scheme.collectionApplyHint')}
            </p>
            <ModeRadio value={mode} onChange={onModeChange} />
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
              onChange={setDefaultId}
              error={chosen ? undefined : t('favorites.scheme.defaultIncompatible')}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t(`favorites.modeHint.${mode}`)}</p>
            {mode === 'activate' ? (
              preview ? (
                <ModelsPreview preview={preview} />
              ) : (
                <p role="status">{t('activate.loading')}</p>
              )
            ) : (
              <div className="space-y-3 rounded-xl border bg-card p-4">
                <p className="text-sm">
                  {t('favorites.scheme.selectedCount', { count: candidates.length })}
                  {chosen
                    ? ` · ${t('toolModels.defaultChanged', { name: favorite.name, model: chosen.requestModelId })}`
                    : ''}
                </p>
                {candidates.map((entry) => (
                  <p key={entry.id} className="break-all font-mono text-sm">
                    {entry.label} / {entry.requestModelId}
                  </p>
                ))}
                <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  {t('favorites.saveOnlyHint')}
                </p>
              </div>
            )}
          </>
        )}
        {error ? <Alert>{error}</Alert> : null}
        <p role="status" className="min-h-5 text-sm">
          {busy
            ? t(
                step === 'choose'
                  ? 'toolModels.previewing'
                  : mode === 'activate'
                    ? 'toolModels.applying'
                    : 'toolModels.saving',
              )
            : done
              ? t(mode === 'activate' ? 'toolModels.applied' : 'favorites.scheme.draftSaved')
              : ''}
        </p>
      </fieldset>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-6 py-4">
        {done ? (
          <>
            <span />
            <Button onClick={onClose}>
              <Check />
              {t('favorites.done')}
            </Button>
          </>
        ) : step === 'choose' ? (
          <>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy || !chosen} onClick={() => void review()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t('favorites.reviewChanges')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={back}>
              <ArrowLeft />
              {t('favorites.backToSelection')}
            </Button>
            <Button
              disabled={busy || (mode === 'activate' && !preview)}
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t(
                mode === 'activate'
                  ? 'favorites.confirmBatchActivate'
                  : 'favorites.confirmBatchSave',
                { count: 1 },
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
