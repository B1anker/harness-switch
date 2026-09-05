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
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { ChannelOverrides } from './channel-overrides';
import { FavoriteFacts, FavoriteSelect } from './fields';

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
    favorite ?? {
      name: '',
      notes: '',
      defaults: {},
      preferences: {},
      connections: [
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
    },
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
    const parsed = createFavoriteRequestSchema.safeParse({
      ...draft,
      name: draft.name || draft.connections[0]?.requestModelId,
      connections: draft.connections.map((connection) => ({
        ...connection,
        label:
          connection.label ||
          providers.find((provider) => provider.id === connection.providerId)?.name ||
          connection.requestModelId,
      })),
    });
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
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle>{t(favorite ? 'favorites.edit' : 'favorites.add')}</DialogTitle>
          <DialogDescription>{t('favorites.declared')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <FormField id="favorite-name" label={t('favorites.name')}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                placeholder={draft.connections[0]?.requestModelId || t('favorites.autoName')}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            )}
          </FormField>
          <Disclosure title={t('favorites.modelAdvanced')}>
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
          </Disclosure>
          <h3 className="font-semibold">{t('favorites.connections')}</h3>
          {draft.connections.map((connection) => (
            <fieldset key={connection.id} className="space-y-3 rounded-xl border p-4">
              <legend>{connection.label || t('favorites.connection')}</legend>
              <Disclosure title={t('favorites.channelName')}>
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
              </Disclosure>
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
              <ChannelOverrides
                favorite={draft}
                connection={connection}
                onChange={(patch) => update(connection.id, patch)}
              />
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
        </div>
        <div className="shrink-0 space-y-3 border-t bg-muted/20 px-6 py-4">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <Button className="w-full" disabled={busy} onClick={() => void submit()}>
            {t('favorites.saveFavorite')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
