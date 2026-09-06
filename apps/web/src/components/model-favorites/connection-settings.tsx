import {
  type FavoriteConnection,
  favoriteEffortSchema,
  type ModelFacts,
} from '@seaveyon/harness-switch-shared';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
import { FavoriteFacts, FavoriteSelect } from './fields';
import { presetProtocolForUrl } from './preset-connections';

const PROTOCOL_LABEL_KEYS = {
  'openai-chat': 'openaiChat',
  'openai-responses': 'openaiResponses',
  'anthropic-messages': 'anthropicMessages',
} as const;

export function ConnectionSettings({
  connection,
  endpoint,
  fieldErrors,
  hasConflict,
  inferredFacts,
  onChange,
}: {
  connection: FavoriteConnection;
  endpoint?: { baseUrl: string };
  fieldErrors: Record<string, string>;
  hasConflict?: boolean;
  inferredFacts?: ModelFacts;
  onChange(patch: Partial<FavoriteConnection>): void;
}) {
  const { t } = useTranslation();
  const hasError =
    hasConflict ||
    Object.keys(fieldErrors).some(
      (key) =>
        key.startsWith(`${connection.id}-`) &&
        !['label', 'model', 'provider'].some((field) => key === `${connection.id}-${field}`),
    );
  const knownProtocol = endpoint && presetProtocolForUrl(endpoint.baseUrl);
  const facts = {
    contextWindow: connection.factOverrides.contextWindow ?? undefined,
    maxOutputTokens: connection.factOverrides.maxOutputTokens ?? undefined,
    reasoningSupported: connection.factOverrides.reasoningSupported ?? undefined,
    supportedReasoningEfforts: connection.factOverrides.supportedReasoningEfforts ?? undefined,
  };
  return (
    <Disclosure
      title={t('favorites.connectionDetails')}
      summary={t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[connection.protocol]}`)}
      forceOpen={hasError || (!!endpoint && !knownProtocol)}
      triggerClassName="h-auto max-w-full flex-wrap justify-start whitespace-normal text-left"
    >
      <p className="text-sm text-muted-foreground">{t('favorites.connectionDetailsHint')}</p>
      {endpoint ? (
        <p className="break-all font-mono text-xs text-muted-foreground">{endpoint.baseUrl}</p>
      ) : null}
      <FavoriteSelect
        id={`${connection.id}-protocol`}
        label={t('favorites.protocol')}
        value={connection.protocol}
        options={(['openai-chat', 'openai-responses', 'anthropic-messages'] as const).map(
          (value) => ({
            value,
            label: t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[value]}`),
            description: value,
          }),
        )}
        error={fieldErrors[`${connection.id}-protocol`]}
        onChange={(protocol) => onChange({ protocol: protocol as FavoriteConnection['protocol'] })}
      />
      <Disclosure
        title={t('favorites.connectionCapabilities')}
        summary={t(
          Object.values(inferredFacts ?? {}).some((value) => value !== undefined)
            ? 'favorites.capabilitiesSource.preset'
            : Object.values(connection.factOverrides).some((value) => value != null)
              ? 'favorites.capabilitiesSource.declared'
              : 'favorites.capabilitiesSource.unspecified',
        )}
        forceOpen={hasError}
        triggerClassName="h-auto whitespace-normal text-left"
      >
        <p className="text-sm text-muted-foreground">{t('favorites.connectionCapabilitiesHint')}</p>
        <FavoriteFacts
          id={connection.id}
          facts={facts}
          effort={connection.preferenceOverrides.reasoningEffort ?? undefined}
          errors={fieldErrors}
          onFacts={(factOverrides) => {
            const changed = Object.fromEntries(
              Object.entries(factOverrides).filter(
                ([key, value]) => value !== facts[key as keyof typeof facts],
              ),
            );
            onChange({ factOverrides: { ...connection.factOverrides, ...changed } });
          }}
          onEffort={(value) =>
            onChange({
              preferenceOverrides: {
                reasoningEffort: favoriteEffortSchema.optional().parse(value || undefined),
              },
            })
          }
        />
      </Disclosure>
    </Disclosure>
  );
}
