import { type FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { FavoriteSelect } from './fields';
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
  onChange,
}: {
  connection: FavoriteConnection;
  endpoint?: { baseUrl: string };
  fieldErrors: Record<string, string>;
  onChange(patch: Partial<FavoriteConnection>): void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const fixedProtocol = endpoint && presetProtocolForUrl(endpoint.baseUrl) === connection.protocol;
  const error = fieldErrors[`${connection.id}-protocol`];
  const showEditor = (!fixedProtocol && editing) || !!error;
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {!showEditor ? (
            <p className="text-xs font-medium">
              {t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[connection.protocol]}`)}
            </p>
          ) : null}
          {endpoint ? (
            <p className="break-all font-mono text-xs text-muted-foreground">{endpoint.baseUrl}</p>
          ) : null}
        </div>
        {!fixedProtocol && !error ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs"
            onClick={() => setEditing(!editing)}
          >
            {t(editing ? 'favorites.done' : 'favorites.changeProtocol')}
          </Button>
        ) : null}
      </div>
      {showEditor ? (
        <FavoriteSelect
          id={`${connection.id}-protocol`}
          label={t('favorites.protocol')}
          value={connection.protocol}
          options={(['openai-chat', 'openai-responses', 'anthropic-messages'] as const).map(
            (value) => ({
              value,
              label: t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[value]}`),
            }),
          )}
          error={fieldErrors[`${connection.id}-protocol`]}
          onChange={(protocol) =>
            onChange({ protocol: protocol as FavoriteConnection['protocol'] })
          }
        />
      ) : null}
    </div>
  );
}
