import {
  createFavoriteRequestSchema,
  type FavoriteConnection,
  type FavoriteInput,
  favoriteEffortSchema,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { FavoriteFacts, FavoriteSelect } from './fields';
import { ReasoningOverrides } from './reasoning-overrides';

export function FavoriteEditor({
  favorite,
  onClose,
}: {
  favorite?: ModelFavorite;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers) ?? [];
  const save = useAppStore((state) => state.saveFavorite);
  const catalogs = useAppStore((state) => state.favoriteCatalogs);
  const loadCatalog = useAppStore((state) => state.loadFavoriteCatalog);
  const [draft, setDraft] = useState<FavoriteInput>(
    favorite ?? { name: '', notes: '', defaults: {}, preferences: {}, connections: [] },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (id: string, patch: Partial<FavoriteConnection>) =>
    setDraft({
      ...draft,
      connections: draft.connections.map((connection) =>
        connection.id === id ? { ...connection, ...patch } : connection,
      ),
    });
  const submit = async () => {
    const parsed = createFavoriteRequestSchema.safeParse(draft);
    if (!parsed.success) {
      setError(t('favorites.invalid'));
      return;
    }
    setBusy(true);
    try {
      await save(parsed.data, favorite);
      onClose();
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(favorite ? 'favorites.edit' : 'favorites.add')}</DialogTitle>
          <DialogDescription>{t('favorites.declared')}</DialogDescription>
        </DialogHeader>
        <FormField id="favorite-name" label={t('favorites.name')}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          )}
        </FormField>
        <FormField id="favorite-notes" label={t('favorites.notes')}>
          {(control) => (
            <Textarea
              {...control}
              maxLength={4096}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          )}
        </FormField>
        <FavoriteFacts
          id="favorite"
          facts={draft.defaults}
          effort={draft.preferences.reasoningEffort}
          onFacts={(defaults) => setDraft({ ...draft, defaults })}
          onEffort={(value) =>
            setDraft({
              ...draft,
              preferences: {
                reasoningEffort: favoriteEffortSchema.optional().parse(value || undefined),
              },
            })
          }
        />
        <h3 className="font-semibold">{t('favorites.connections')}</h3>
        {draft.connections.map((connection) => (
          <fieldset key={connection.id} className="space-y-3 rounded-xl border p-4">
            <legend>{connection.label || t('favorites.connection')}</legend>
            <FormField id={`${connection.id}-label`} label={t('favorites.label')}>
              {(control) => (
                <Input
                  {...control}
                  value={connection.label}
                  maxLength={120}
                  onChange={(event) => update(connection.id, { label: event.target.value })}
                />
              )}
            </FormField>
            <FavoriteSelect
              id={`${connection.id}-provider`}
              label={t('favorites.endpoint')}
              value={
                connection.providerId ? `${connection.providerId}/${connection.endpointKey}` : ''
              }
              options={providers.flatMap((provider) =>
                provider.endpoints.map((endpoint) => ({
                  value: `${provider.id}/${endpoint.key}`,
                  label: `${provider.name} · ${endpoint.label || endpoint.key}`,
                })),
              )}
              onChange={(value) => {
                const [providerId, endpointKey] = value.split('/');
                update(connection.id, { providerId, endpointKey });
              }}
            />
            <FavoriteSelect
              id={`${connection.id}-protocol`}
              label={t('favorites.protocol')}
              value={connection.protocol}
              options={['openai-chat', 'openai-responses', 'anthropic-messages'].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(value) =>
                update(connection.id, { protocol: value as FavoriteConnection['protocol'] })
              }
            />
            <FormField id={`${connection.id}-model`} label={t('favorites.model')}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={connection.requestModelId}
                  onChange={(event) =>
                    update(connection.id, { requestModelId: event.target.value })
                  }
                />
              )}
            </FormField>
            {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
              <FormField
                key={field}
                id={`${connection.id}-${field}`}
                label={t(`favorites.${field}`)}
                hint={
                  connection.factOverrides[field] === undefined
                    ? `${t('favorites.inherited')}: ${draft.defaults[field] ?? t('favorites.unknown')}`
                    : t('favorites.overridden')
                }
              >
                {(control) => (
                  <div className="flex gap-2">
                    <Input
                      {...control}
                      type="number"
                      min={1}
                      max={100000000}
                      value={connection.factOverrides[field] ?? ''}
                      onChange={(event) =>
                        update(connection.id, {
                          factOverrides: {
                            ...connection.factOverrides,
                            [field]: event.target.value ? Number(event.target.value) : null,
                          },
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const next = { ...connection.factOverrides };
                        delete next[field];
                        update(connection.id, { factOverrides: next });
                      }}
                    >
                      {t('favorites.inherit')}
                    </Button>
                  </div>
                )}
              </FormField>
            ))}
            <Button
              variant="outline"
              disabled={busy || !connection.providerId || !connection.endpointKey}
              onClick={async () => {
                setBusy(true);
                try {
                  await loadCatalog(connection.providerId, connection.endpointKey);
                } catch (cause) {
                  setError(lineText(t, errorLine(cause)));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('favorites.catalog')}
            </Button>
            {catalogs[`${connection.providerId}/${connection.endpointKey}`]?.models?.length ? (
              <FavoriteSelect
                id={`${connection.id}-catalog`}
                label={t('favorites.catalogModel')}
                value={connection.requestModelId}
                options={catalogs[
                  `${connection.providerId}/${connection.endpointKey}`
                ]!.models!.map((model) => ({ value: model, label: model }))}
                onChange={(requestModelId) => update(connection.id, { requestModelId })}
              />
            ) : catalogs[`${connection.providerId}/${connection.endpointKey}`] ? (
              <p>{t('favorites.noCatalog')}</p>
            ) : null}
            <ReasoningOverrides
              favorite={draft}
              connection={connection}
              onChange={(patch) => update(connection.id, patch)}
            />
            <Button
              variant="outline"
              onClick={() =>
                setDraft({
                  ...draft,
                  connections: draft.connections.filter((item) => item.id !== connection.id),
                })
              }
            >
              {t('favorites.removeConnection')}
            </Button>
          </fieldset>
        ))}
        <Button
          variant="outline"
          disabled={draft.connections.length >= 50}
          onClick={() =>
            setDraft({
              ...draft,
              connections: [
                ...draft.connections,
                {
                  id: crypto.randomUUID(),
                  label: '',
                  providerId: '',
                  endpointKey: '',
                  protocol: 'openai-responses',
                  requestModelId: '',
                  factOverrides: {},
                  preferenceOverrides: {},
                },
              ],
            })
          }
        >
          {t('favorites.addConnection')}
        </Button>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <Button disabled={busy} onClick={() => void submit()}>
          {t('favorites.saveFavorite')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
