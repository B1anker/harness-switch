import type { ModelFavorite } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { FavoriteEditor } from './editor';
import { FavoriteSelect } from './fields';

export function ModelFavorites() {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const loadError = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const remove = useAppStore((state) => state.deleteFavorite);
  const capture = useAppStore((state) => state.captureFavorite);
  const detach = useAppStore((state) => state.detachFavorite);
  const harnesses = useAppStore((state) => state.harnesses);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ModelFavorite | 'new' | null>(null);
  const [applying, setApplying] = useState<ModelFavorite | null>(null);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [credential, setCredential] = useState(false);
  const [linkSource, setLinkSource] = useState(false);
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
  const sources = harnesses.flatMap((harness) =>
    harness.profiles
      .filter(
        (profile) =>
          !profile.modelFavorite &&
          !profile.overriddenTargets.length &&
          profile.name !== harness.official?.linkedProfileName,
      )
      .map((profile) => ({
        harness: harness.id,
        profile,
        value: JSON.stringify([harness.id, profile.name]),
      })),
  );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t('favorites.title')}</h2>
          <p className="text-muted-foreground">{t('favorites.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing('new')}>{t('favorites.add')}</Button>
        </div>
      </div>
      <Disclosure title={t('favorites.capture')}>
        <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <FavoriteSelect
            id="favorite-source"
            label={t('favorites.capture')}
            value={source}
            options={sources.map((item) => ({
              value: item.value,
              label: `${item.harness} / ${item.profile.name}`,
            }))}
            onChange={(value) => {
              setSource(value);
              const item = sources.find((candidate) => candidate.value === value);
              setName(item?.profile.name ?? '');
            }}
          />
          <FormField id="capture-name" label={t('favorites.name')}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          {source && !sources.find((item) => item.value === source)?.profile.providerId ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="capture-credential"
                checked={credential}
                onCheckedChange={(value) => setCredential(value === true)}
              />
              <label htmlFor="capture-credential">{t('favorites.extractCredential')}</label>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="capture-link"
              checked={linkSource}
              onCheckedChange={(value) => setLinkSource(value === true)}
            />
            <label htmlFor="capture-link">{t('favorites.linkSource')}</label>
          </div>
          <Button
            disabled={busy || !source || !name}
            onClick={() =>
              void run(async () => {
                const item = sources.find((candidate) => candidate.value === source);
                if (item) {
                  await capture(item.harness, item.profile.name, name, credential, linkSource);
                  setSource('');
                }
              })
            }
          >
            {t('favorites.capture')}
          </Button>
        </section>
      </Disclosure>
      <FormField id="favorite-search" label={t('favorites.search')}>
        {(control) => (
          <Input {...control} value={search} onChange={(event) => setSearch(event.target.value)} />
        )}
      </FormField>
      {loading ? <p role="status">{t('favorites.loading')}</p> : null}
      {loadError ? <p role="alert">{lineText(t, loadError)}</p> : null}
      {!favorites?.length && !loading && !loadError ? <p>{t('favorites.empty')}</p> : null}
      {favorites
        ?.filter((favorite) =>
          [
            favorite.name,
            ...favorite.connections.flatMap((connection) => [
              connection.label,
              connection.requestModelId,
            ]),
          ].some((text) => text.toLowerCase().includes(search.toLowerCase())),
        )
        .map((favorite) => (
          <article key={favorite.id} className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{favorite.name}</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {favorite.notes}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(favorite)}>
                  {t('favorites.edit')}
                </Button>
                <Button
                  disabled={!favorite.connections.length}
                  onClick={() => setApplying(favorite)}
                >
                  {t('favorites.configure')}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !!favorite.references.length}
                  onClick={() => void run(() => remove(favorite))}
                >
                  {t('favorites.delete')}
                </Button>
              </div>
            </div>
            <p>
              {t('favorites.connections')}: {favorite.connections.length || t('favorites.pending')}
            </p>
            {favorite.connections.map((connection) => (
              <p key={connection.id} className="text-sm">
                {connection.label} · {connection.requestModelId} · {connection.protocol}
              </p>
            ))}
            <h4 className="font-medium">{t('favorites.generated')}</h4>
            {favorite.references.map((ref) => (
              <div
                key={`${ref.harness}/${ref.name}`}
                className="flex items-center justify-between gap-2"
              >
                <p>
                  {ref.harness} / {ref.name} {ref.needsUpdate ? t('favorites.needsUpdate') : ''}{' '}
                  {ref.diverged ? t('favorites.diverged') : ''}
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => detach(ref.harness, ref.name))}
                >
                  {t('favorites.detach')}
                </Button>
              </div>
            ))}
          </article>
        ))}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {editing ? (
        <FavoriteEditor
          favorite={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {applying ? (
        <ModelFavoriteApplyDialog favorite={applying} onClose={() => setApplying(null)} />
      ) : null}
    </main>
  );
}
