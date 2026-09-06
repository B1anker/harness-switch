import type {
  FavoriteInput,
  FavoritePlanRequest,
  ModelFacts,
  ProviderPreset,
  ProviderPublic,
} from '@seaveyon/harness-switch-shared';
import { ArrowDownToLine, Box, Copy, Plus, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { CaptureFavorite } from './capture';
import { FavoriteCreateDialog } from './create-dialog';
import { FavoriteEditor } from './editor';
import { FavoriteRelationships } from './relationships';
import { SUGGESTED_FACTS } from './suggested-defaults';

type EditingState =
  | { kind: 'new' }
  | { kind: 'edit'; favorite: FavoriteListItem }
  | {
      kind: 'draft';
      draft: FavoriteInput;
      modelHints?: Record<string, string[]>;
      hintFacts?: Record<string, ModelFacts>;
    };

export function ModelFavorites({ initialSelectedId = '' }: { initialSelectedId?: string }) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const loadError = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const remove = useAppStore((state) => state.deleteFavorite);
  const clear = useAppStore((state) => state.clearFavoritePlan);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState<FavoritePlanRequest['items'] | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);
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
  const startFromPreset = (
    preset: ProviderPreset,
    provider: ProviderPublic,
    endpointKey: string,
  ) => {
    setCreating(false);
    setEditing({
      kind: 'draft',
      draft: {
        name: '',
        notes: '',
        defaults: preset.defaultFacts ?? { ...SUGGESTED_FACTS },
        preferences: {},
        connections: [
          {
            id: crypto.randomUUID(),
            label: '',
            providerId: provider.id,
            endpointKey,
            protocol: preset.protocols[0]!,
            requestModelId: '',
            factOverrides: {},
            preferenceOverrides: {},
          },
        ],
      },
      modelHints: preset.modelCatalog?.length
        ? {
            [`${provider.id}/${endpointKey}`]: preset.modelCatalog.map(
              (model) => model.requestModelId,
            ),
          }
        : undefined,
      hintFacts: Object.fromEntries(
        (preset.modelCatalog ?? [])
          .filter((model) => model.facts)
          .map((model) => [model.requestModelId, model.facts!]),
      ),
    });
  };
  const cloneFavorite = (source: FavoriteListItem) =>
    setEditing({
      kind: 'draft',
      draft: {
        name: t('favorites.clone.name', { name: source.name }),
        notes: source.notes,
        defaults: { ...source.defaults },
        preferences: { ...source.preferences },
        connections: source.connections.map((connection) => ({
          ...connection,
          id: crypto.randomUUID(),
          factOverrides: { ...connection.factOverrides },
          preferenceOverrides: { ...connection.preferenceOverrides },
        })),
      },
    });
  const filtered =
    favorites?.filter((favorite) =>
      [
        favorite.name,
        ...favorite.connections.flatMap((connection) => [
          connection.label,
          connection.requestModelId,
        ]),
      ].some((text) => text.toLowerCase().includes(search.toLowerCase())),
    ) ?? [];
  const selected = filtered.find((entry) => entry.id === selectedId) ?? filtered[0];
  return (
    <main className="workspace-page space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="workspace-eyebrow">{t('workspace.favoriteEyebrow')}</p>
          <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('favorites.title')}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{t('workspace.favoriteHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCapturing(true)}>
            <ArrowDownToLine />
            {t('favorites.capture')}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('favorites.add')}
          </Button>
        </div>
      </div>
      {loading ? <p role="status">{t('favorites.loading')}</p> : null}
      {loadError ? <Alert>{lineText(t, loadError)}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {!favorites?.length && !loading && !loadError ? (
        <section className="workspace-surface space-y-4 p-8 sm:p-12">
          <Star className="size-10 text-primary" />
          <h3 className="text-xl font-semibold">{t('workspace.startTitle')}</h3>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            {t('workspace.startHint')}
          </p>
          <Button onClick={() => setCapturing(true)}>{t('favorites.capture')}</Button>
        </section>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            <FormField id="favorite-search" label={t('favorites.search')}>
              {(control) => (
                <Input
                  {...control}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              )}
            </FormField>
            <div className="space-y-2">
              {filtered.map((favorite) => (
                <button
                  key={favorite.id}
                  type="button"
                  aria-pressed={favorite.id === selected?.id}
                  onClick={() => setSelectedId(favorite.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                    favorite.id === selected?.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-transparent hover:bg-card',
                  )}
                >
                  <Box className="mt-1 size-5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <h3 className="break-words font-semibold">{favorite.name}</h3>
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                      {favorite.connections[0]?.requestModelId ?? t('favorites.pending')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {!filtered.length ? (
              <p className="text-sm text-muted-foreground">{t('workspace.noMatches')}</p>
            ) : null}
          </aside>
          {selected ? (
            <article className="workspace-surface min-w-0 space-y-6 p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {selected.notes || t('workspace.favoriteDetail')}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => cloneFavorite(selected)}>
                    <Copy />
                    {t('favorites.clone.action')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ kind: 'edit', favorite: selected })}
                  >
                    {t('favorites.edit')}
                  </Button>
                  <Button
                    disabled={!selected.connections.length}
                    onClick={() => {
                      clear();
                      setApplying([]);
                    }}
                  >
                    {t('favorites.configure')}
                  </Button>
                </div>
              </div>
              <FavoriteRelationships
                key={selected.id + '/' + selected.revision}
                favorite={selected}
                onApply={(items) => {
                  clear();
                  setApplying(items);
                }}
              />
              <Disclosure title={t('workspace.manageLinks')}>
                <div className="space-y-3">
                  {selected.references.map((ref) => (
                    <div
                      key={ref.harness + '/' + ref.name}
                      className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
                    >
                      <p className="min-w-0 break-all text-sm">
                        {ref.harness} / {ref.name}{' '}
                        {ref.needsUpdate ? t('favorites.needsUpdate') : ''}{' '}
                        {ref.diverged ? t('favorites.diverged') : ''}
                      </p>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy || !!selected.references.length}
                    onClick={() => void run(() => remove(selected))}
                  >
                    {t('favorites.delete')}
                  </Button>
                </div>
              </Disclosure>
            </article>
          ) : null}
        </div>
      )}
      {creating ? (
        <FavoriteCreateDialog
          onClose={() => setCreating(false)}
          onCapture={() => {
            setCreating(false);
            setCapturing(true);
          }}
          onBlank={() => {
            setCreating(false);
            setEditing({ kind: 'new' });
          }}
          onPreset={startFromPreset}
        />
      ) : null}
      {editing ? (
        <FavoriteEditor
          favorite={editing.kind === 'edit' ? editing.favorite : undefined}
          initialDraft={editing.kind === 'draft' ? editing.draft : undefined}
          modelHints={editing.kind === 'draft' ? editing.modelHints : undefined}
          hintFacts={editing.kind === 'draft' ? editing.hintFacts : undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved, next) => {
            setSelectedId(saved.id);
            if (next === 'configure') {
              clear();
              setApplying([]);
            }
          }}
        />
      ) : null}
      {capturing ? <CaptureFavorite onClose={() => setCapturing(false)} /> : null}
      {applying && selected ? (
        <ModelFavoriteApplyDialog
          favorite={selected}
          initialItems={applying}
          initialMode={applying.length ? 'activate' : 'save'}
          onClose={() => setApplying(null)}
        />
      ) : null}
    </main>
  );
}
