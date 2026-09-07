import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { ConnectionCard } from '../connection-card';

export function FavoriteConnections({
  draft,
  setDraft,
  providers,
  busy,
  fieldErrors,
  cardErrors,
  modelHints,
  openVault,
  update,
  addConnection,
}: {
  draft: FavoriteInput;
  setDraft: Dispatch<SetStateAction<FavoriteInput>>;
  providers: { id: string; name: string }[];
  busy: boolean;
  fieldErrors: Record<string, string>;
  cardErrors: Record<string, string>;
  modelHints?: Record<string, string[]>;
  openVault(id: string | null): void;
  update(id: string, patch: Partial<FavoriteConnection>): void;
  addConnection(): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FormField
        id="favorite-name"
        label={t('favorites.name')}
        error={fieldErrors['favorite-name']}
      >
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
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">{t('favorites.connections')}</h3>
        <p className="min-w-0 truncate text-muted-foreground text-xs">
          {t('favorites.channelHint')}
        </p>
      </div>
      {draft.connections.map((connection, index) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          index={index}
          disabled={busy}
          error={cardErrors[connection.id]}
          fieldErrors={fieldErrors}
          modelHints={modelHints?.[`${connection.providerId}/${connection.endpointKey}`]}
          onAddProvider={() => openVault(connection.id)}
          onChange={(patch) => update(connection.id, patch)}
          onRemove={() =>
            setDraft({
              ...draft,
              connections: draft.connections.filter((item) => item.id !== connection.id),
            })
          }
        />
      ))}
      {!draft.connections.length ? (
        <div className="space-y-3 rounded-xl border border-dashed px-4 py-8 text-center">
          <p className="text-muted-foreground text-sm">{t('favorites.connectionsEmpty')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" disabled={busy} onClick={addConnection}>
              {t('favorites.addConnection')}
            </Button>
            {!providers.length ? (
              <Button variant="ghost" disabled={busy} onClick={() => openVault(null)}>
                {t('favorites.addProvider')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full border-dashed text-muted-foreground"
          disabled={busy || draft.connections.length >= 50}
          onClick={addConnection}
        >
          {t('favorites.addConnection')}
        </Button>
      )}
      <Disclosure
        title={t('favorites.notesOptional')}
        forceOpen={!!fieldErrors['favorite-notes']}
        triggerClassName="-ml-4"
      >
        <FormField
          id="favorite-notes"
          label={t('favorites.notes')}
          error={fieldErrors['favorite-notes']}
        >
          {(control) => (
            <Textarea
              {...control}
              maxLength={4096}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          )}
        </FormField>
      </Disclosure>
    </>
  );
}
