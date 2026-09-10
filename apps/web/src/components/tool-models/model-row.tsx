import {
  type ModelFacts,
  type ModelFavorite,
  resolveFavorite,
  type ToolModelItem,
} from '@seaveyon/harness-switch-shared';
import { FavoriteFacts, FavoriteSelect } from '@/components/model-favorites/fields';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';

export function ModelRow({
  item,
  favorite,
  onChange,
  onRemove,
}: {
  item: ToolModelItem;
  favorite?: ModelFavorite;
  onChange(item: ToolModelItem): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const source = item.source;
  const connection =
    source.kind === 'favorite'
      ? favorite?.connections.find((entry) => entry.id === source.connectionId)
      : undefined;
  const resolved =
    favorite && connection
      ? resolveFavorite(favorite, {
          ...connection,
          factOverrides: { ...connection.factOverrides, ...item.factOverrides },
          preferenceOverrides: { ...connection.preferenceOverrides, ...item.preferenceOverrides },
        })
      : undefined;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {source.kind === 'profile' ? source.name : (favorite?.name ?? t('toolModels.missing'))}
          </p>
          {connection ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {connection.requestModelId}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          {t('toolModels.remove')}
        </Button>
      </div>
      {favorite && source.kind === 'favorite' ? (
        <FavoriteSelect
          id={`${item.id}-connection`}
          label={t('toolModels.connection')}
          value={source.connectionId}
          options={favorite.connections.map((entry) => ({
            value: entry.id,
            label: entry.label,
            description: entry.requestModelId,
          }))}
          onChange={(connectionId) =>
            onChange({
              ...item,
              source: { ...source, connectionId },
              factOverrides: {},
              preferenceOverrides: {},
            })
          }
        />
      ) : null}
      {resolved ? (
        <Disclosure title={t('toolModels.settings')}>
          <p className="mb-3 text-xs text-muted-foreground">{t('toolModels.inheritHint')}</p>
          <FavoriteFacts
            id={item.id}
            facts={resolved.facts}
            effort={resolved.preferences.reasoningEffort}
            onFacts={(facts) => {
              const overrides = { ...item.factOverrides };
              for (const key of [
                'contextWindow',
                'maxOutputTokens',
                'reasoningSupported',
                'supportedReasoningEfforts',
              ] as const) {
                if (JSON.stringify(facts[key]) !== JSON.stringify(resolved.facts[key])) {
                  Object.assign(overrides, { [key]: facts[key as keyof ModelFacts] ?? null });
                }
              }
              onChange({ ...item, factOverrides: overrides });
            }}
            onEffort={(effort) =>
              onChange({
                ...item,
                preferenceOverrides: {
                  reasoningEffort:
                    effort === 'unknown'
                      ? null
                      : (effort as NonNullable<
                          ToolModelItem['preferenceOverrides']['reasoningEffort']
                        >),
                },
              })
            }
          />
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...item, factOverrides: {}, preferenceOverrides: {} })}
          >
            {t('toolModels.reset')}
          </Button>
        </Disclosure>
      ) : null}
    </div>
  );
}
