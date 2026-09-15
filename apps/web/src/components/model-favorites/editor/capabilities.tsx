import {
  type FavoriteConnection,
  type FavoriteInput,
  favoriteEffortSchema,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { type InferredFacts, updateDefaultFacts } from '../draft-facts';
import { FavoriteFacts } from '../fields';
import { modelGroups } from './model-groups';

export function FavoriteCapabilities({
  draft,
  setDraft,
  update,
  inferredFacts,
  fieldErrors,
  cardErrors,
  focusConnectionId,
}: {
  draft: FavoriteInput;
  setDraft: Dispatch<SetStateAction<FavoriteInput>>;
  update(id: string, patch: Partial<FavoriteConnection>): void;
  inferredFacts: InferredFacts;
  fieldErrors: Record<string, string>;
  cardErrors: Record<string, string>;
  focusConnectionId?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const needsAttention = (entry: FavoriteConnection) =>
    entry.id === focusConnectionId ||
    !!cardErrors[entry.id] ||
    Object.keys(fieldErrors).some((key) => key.startsWith(entry.id + '-'));
  const visible = draft.connections.filter(
    (entry) =>
      needsAttention(entry) ||
      `${entry.label} ${entry.requestModelId}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-label={t('favorites.sharedCapabilities')}>
        <div>
          <h3 className="font-semibold">{t('favorites.sharedCapabilities')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('favorites.sharedCapabilitiesHint')}
          </p>
        </div>
        <FavoriteFacts
          id="favorite"
          facts={draft.defaults}
          effort={draft.preferences.reasoningEffort}
          errors={fieldErrors}
          onFacts={(defaults) => setDraft((current) => updateDefaultFacts(current, defaults))}
          onEffort={(value) =>
            setDraft((current) => ({
              ...current,
              preferences: {
                reasoningEffort: favoriteEffortSchema.optional().parse(value || undefined),
              },
            }))
          }
        />
      </section>
      {draft.connections.length ? (
        <section
          className="space-y-3 border-t pt-5"
          aria-label={t('favorites.connectionCapabilities')}
        >
          <h3 className="font-semibold">{t('favorites.connectionCapabilities')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('favorites.connectionCapabilitiesHint')}
          </p>
          <Input
            aria-label={t('favorites.scheme.searchModels')}
            placeholder={t('favorites.scheme.searchModels')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {modelGroups(visible).map((group, groupIndex) => (
            <div key={group[0]!.groupId ?? group[0]!.id} className="rounded-xl border p-4">
              <Disclosure
                title={group[0]!.label || t('favorites.channelNumber', { count: groupIndex + 1 })}
                summary={t('favorites.scheme.selectedCount', { count: group.length })}
                forceOpen={!!query.trim() || group.some(needsAttention)}
                triggerClassName="h-auto w-full flex-wrap justify-start whitespace-normal px-0 text-left"
              >
                {group.map((connection, index) => {
                  const resolved = resolveFavorite(draft, connection);
                  const hasOverrides =
                    Object.values(connection.factOverrides).some((value) => value !== undefined) ||
                    connection.preferenceOverrides.reasoningEffort !== undefined;
                  const hasError =
                    !!cardErrors[connection.id] ||
                    Object.keys(fieldErrors).some((key) => key.startsWith(connection.id + '-'));
                  const sourceHints = Object.fromEntries(
                    Object.entries(resolved.sources).map(([key, source]) => [
                      key,
                      t(
                        source === 'favorite'
                          ? 'favorites.inheritedValue'
                          : source === 'connection'
                            ? 'favorites.overriddenValue'
                            : 'favorites.unspecifiedValue',
                      ),
                    ]),
                  );
                  return (
                    <div key={connection.id} className="rounded-xl border p-4">
                      <Disclosure
                        title={
                          connection.requestModelId ||
                          t('favorites.channelNumber', { count: index + 1 })
                        }
                        summary={t(
                          hasOverrides ? 'favorites.overriddenValue' : 'favorites.inheritedValue',
                        )}
                        defaultOpen={group.length === 1}
                        forceOpen={hasError || connection.id === focusConnectionId}
                        triggerClassName="h-auto max-w-full flex-wrap justify-start whitespace-normal px-0 text-left"
                      >
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {connection.requestModelId} · {connection.protocol}
                        </p>
                        {cardErrors[connection.id] ? (
                          <p role="alert" className="text-sm text-destructive">
                            {cardErrors[connection.id]}
                          </p>
                        ) : null}
                        {Object.keys(inferredFacts[connection.id] ?? {}).length ? (
                          <p className="text-xs text-muted-foreground">
                            {t('favorites.capabilitiesSource.preset')}
                          </p>
                        ) : null}
                        <FavoriteFacts
                          id={connection.id}
                          facts={resolved.facts}
                          effort={resolved.preferences.reasoningEffort}
                          errors={fieldErrors}
                          sourceHints={sourceHints}
                          onFacts={(facts) => {
                            const changed = Object.fromEntries(
                              Object.entries(facts)
                                .filter(
                                  ([key, value]) =>
                                    JSON.stringify(value) !==
                                    JSON.stringify(resolved.facts[key as keyof typeof facts]),
                                )
                                .map(([key, value]) => [key, value ?? null]),
                            );
                            update(connection.id, {
                              factOverrides: { ...connection.factOverrides, ...changed },
                            });
                          }}
                          onEffort={(value) =>
                            update(connection.id, {
                              preferenceOverrides: {
                                reasoningEffort: value ? favoriteEffortSchema.parse(value) : null,
                              },
                            })
                          }
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!hasOverrides}
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              connections: current.connections.map((entry) =>
                                entry.id === connection.id
                                  ? { ...entry, factOverrides: {}, preferenceOverrides: {} }
                                  : entry,
                              ),
                            }));
                          }}
                        >
                          {t('favorites.resetInheritance')}
                        </Button>
                      </Disclosure>
                    </div>
                  );
                })}
              </Disclosure>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
