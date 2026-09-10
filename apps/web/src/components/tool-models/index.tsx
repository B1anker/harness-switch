import type {
  ToolModelDraft,
  ToolModelsHarness,
  ToolModelsState,
} from '@seaveyon/harness-switch-shared';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { ModelRow } from './model-row';
import { ModelsPreview } from './preview';

export function ToolModels({ harness }: { harness: ToolModelsHarness }) {
  const { t } = useTranslation();
  const user = useAppStore((state) => state.currentUser);
  const saved = useAppStore(
    (state) => state.toolModels.find((entry) => entry.harness === harness)?.state,
  );
  const loading = useAppStore((state) => state.toolModelsLoading);
  const error = useAppStore((state) => state.toolModelsError);
  const load = useAppStore((state) => state.loadToolModels);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) {
      void load(harness);
    }
  }, [open, harness, user, load]);
  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t('toolModels.title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('toolModels.hint')}</p>
        </div>
        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('toolModels.manage')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => void load(harness)}>
            {t('toolModels.retry')}
          </Button>
        )}
      </div>
      {open && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('toolModels.loading')}
        </p>
      ) : null}
      {open && error ? (
        <div className="space-y-2">
          <Alert>{lineText(t, error)}</Alert>
          <Button variant="outline" onClick={() => void load(harness)}>
            {t('toolModels.retry')}
          </Button>
        </div>
      ) : null}
      {open && saved && !loading ? (
        <ModelsEditor key={`${user}/${harness}`} harness={harness} saved={saved} />
      ) : null}
    </section>
  );
}

function ModelsEditor({ harness, saved }: { harness: ToolModelsHarness; saved: ToolModelsState }) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loadFavorites = useAppStore((state) => state.loadFavorites);
  const favoritesError = useAppStore((state) => state.favoritesError);
  const preview = useAppStore((state) => state.toolModelsPreview);
  const save = useAppStore((state) => state.saveToolModels);
  const plan = useAppStore((state) => state.previewToolModels);
  const apply = useAppStore((state) => state.applyToolModels);
  const clear = useAppStore((state) => state.clearToolModelsPreview);
  const editDraft = useAppStore((state) => state.editToolModelsDraft);
  const [draft, setDraft] = useState<ToolModelDraft>(() => {
    const pending = useAppStore.getState().toolModelsDrafts[harness];
    return structuredClone(
      pending?.expectedRevision === saved.revision ? pending.draft : saved.draft,
    );
  });
  const [error, setError] = useState<MessageLine | null>(null);
  const [busy, setBusy] = useState<'saving' | 'previewing' | 'applying' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    const pending = useAppStore.getState().toolModelsDrafts[harness];
    setDraft(
      structuredClone(pending?.expectedRevision === saved.revision ? pending.draft : saved.draft),
    );
  }, [saved, harness]);
  useEffect(() => {
    void loadFavorites();
    clear();
    return clear;
  }, [loadFavorites, clear]);
  const change = (next: ToolModelDraft) => {
    setDraft(next);
    editDraft(harness, { expectedRevision: saved.revision, draft: next });
    clear();
    setStatus(null);
    setError(null);
  };
  const run = async (phase: NonNullable<typeof busy>, operation: () => Promise<void>) => {
    setBusy(phase);
    setError(null);
    setStatus(null);
    try {
      await operation();
      setStatus(
        phase === 'saving'
          ? 'toolModels.saved'
          : phase === 'applying'
            ? 'toolModels.applied'
            : null,
      );
    } catch (failure) {
      setError(errorLine(failure));
    } finally {
      setBusy(null);
    }
  };
  const request = { expectedRevision: saved.revision, draft };
  return (
    <fieldset disabled={!!busy} className="min-w-0 space-y-4">
      <p className="text-xs text-muted-foreground">
        {t('toolModels.appliedCount', { count: saved.applied.length })} ·{' '}
        {t('toolModels.draftHint')}
      </p>
      {saved.nativeStatus ? (
        <Alert
          variant={
            saved.nativeStatus === 'drifted' || saved.nativeStatus === 'invalid'
              ? 'warning'
              : 'muted'
          }
        >
          {t(`toolModels.nativeStatus.${saved.nativeStatus}`)}
        </Alert>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {draft.items.map((item) => (
          <ModelRow
            key={item.id}
            item={item}
            favorite={
              item.source.kind === 'favorite'
                ? favorites?.find(
                    (favorite) =>
                      item.source.kind === 'favorite' && favorite.id === item.source.favoriteId,
                  )
                : undefined
            }
            onChange={(next) =>
              change({
                ...draft,
                items: draft.items.map((entry) => (entry.id === item.id ? next : entry)),
              })
            }
            onRemove={() =>
              change({
                ...draft,
                items: draft.items.filter((entry) => entry.id !== item.id),
                defaultItemId: draft.defaultItemId === item.id ? null : draft.defaultItemId,
              })
            }
          />
        ))}
      </div>
      {!draft.items.length ? (
        <p className="text-sm text-muted-foreground">{t('toolModels.empty')}</p>
      ) : null}
      <div className="space-y-2 rounded-xl border border-dashed p-4">
        <h4 className="text-sm font-medium">{t('toolModels.add')}</h4>
        {favoritesError ? <Alert>{lineText(t, favoritesError)}</Alert> : null}
        {favorites
          ?.filter((favorite) => favorite.connections.length)
          .map((favorite) => {
            const added = draft.items.some(
              (item) => item.source.kind === 'favorite' && item.source.favoriteId === favorite.id,
            );
            return (
              <label key={favorite.id} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={added}
                  disabled={added || draft.items.length >= 50}
                  onCheckedChange={() =>
                    change({
                      ...draft,
                      items: [
                        ...draft.items,
                        {
                          id: crypto.randomUUID(),
                          source: {
                            kind: 'favorite',
                            favoriteId: favorite.id,
                            connectionId: favorite.connections[0]!.id,
                          },
                          factOverrides: {},
                          preferenceOverrides: {},
                        },
                      ],
                    })
                  }
                />
                {favorite.name}
              </label>
            );
          })}
        {favorites?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('toolModels.noTemplates')}</p>
        ) : null}
      </div>
      <FavoriteSelect
        id={`${harness}-default-model`}
        label={t('toolModels.default')}
        value={draft.defaultItemId ?? 'keep'}
        options={[
          { value: 'keep', label: t('toolModels.keepDefault') },
          ...draft.items.map((item) => ({
            value: item.id,
            label:
              item.source.kind === 'profile'
                ? item.source.name
                : (favorites?.find(
                    (favorite) =>
                      item.source.kind === 'favorite' && favorite.id === item.source.favoriteId,
                  )?.name ?? t('toolModels.missing')),
          })),
        ]}
        onChange={(value) => change({ ...draft, defaultItemId: value === 'keep' ? null : value })}
      />
      <p className="text-xs text-muted-foreground">{t(`toolModels.scope.${harness}`)}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void run('saving', () => save(harness, request))}>
          {t('toolModels.save')}
        </Button>
        <Button onClick={() => void run('previewing', () => plan(harness, request))}>
          {t('toolModels.preview')}
        </Button>
      </div>
      <div className="min-h-6 text-sm" aria-live="polite">
        {busy ? (
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            {t(`toolModels.${busy}`)}
          </span>
        ) : status ? (
          t(status)
        ) : null}
        {error ? <Alert>{lineText(t, error)}</Alert> : null}
      </div>
      {preview ? (
        <ModelsPreview
          preview={preview}
          onApply={() => void run('applying', () => apply(harness, preview.id))}
        />
      ) : null}
    </fieldset>
  );
}
