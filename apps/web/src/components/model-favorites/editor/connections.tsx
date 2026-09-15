import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { ConnectionCard } from '../connection-card';
import { FavoriteSelect } from '../fields';
import { modelGroups } from './model-groups';

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
  onModelSettings,
  selectModels,
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
  onModelSettings?(id: string): void;
  selectModels(group: FavoriteConnection[], models: string[]): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">{t('favorites.connections')}</h3>
        <p className="min-w-0 truncate text-muted-foreground text-xs">
          {t('favorites.channelHint')}
        </p>
      </div>
      {modelGroups(draft.connections).map((group, index) => {
        const connection = group[0]!;
        return (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            index={index}
            disabled={busy}
            models={group}
            onModelSettings={onModelSettings}
            onModelsChange={(models) => selectModels(group, models)}
            error={cardErrors[connection.id]}
            fieldErrors={fieldErrors}
            modelHints={modelHints?.[`${connection.providerId}/${connection.endpointKey}`]}
            onAddProvider={() => openVault(connection.id)}
            onChange={(patch) => {
              for (const item of group) {
                update(item.id, patch);
              }
            }}
            onRemove={() =>
              setDraft({
                ...draft,
                connections: draft.connections.filter(
                  (item) => !group.some((entry) => entry.id === item.id),
                ),
              })
            }
          />
        );
      })}
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
          variant="link"
          className="h-auto px-0 text-primary"
          disabled={busy || draft.connections.length >= 50}
          onClick={addConnection}
        >
          {t('favorites.addConnection')}
        </Button>
      )}
      <FavoriteSelect
        id="favorite-default-model"
        label={t('favorites.scheme.defaultModel')}
        value={draft.defaultConnectionId ?? ''}
        placeholder={t('favorites.scheme.chooseDefault')}
        hint={t('favorites.scheme.defaultHint')}
        options={draft.connections
          .filter((connection) => connection.requestModelId)
          .map((connection) => ({
            value: connection.id,
            label: `${connection.label || providers.find((provider) => provider.id === connection.providerId)?.name || ''} / ${connection.requestModelId}`,
          }))}
        onChange={(defaultConnectionId) => setDraft({ ...draft, defaultConnectionId })}
        error={
          draft.defaultConnectionId &&
          !draft.connections.some((connection) => connection.id === draft.defaultConnectionId)
            ? t('favorites.scheme.defaultRemoved')
            : undefined
        }
      />
      <FormField
        id="favorite-notes"
        label={t('favorites.notesOptional')}
        error={fieldErrors['favorite-notes']}
      >
        {(control) => (
          <Textarea
            {...control}
            className="min-h-16"
            maxLength={4096}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        )}
      </FormField>
    </>
  );
}
