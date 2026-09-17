import {
  connectionProtocols,
  type FavoriteConnection,
  type FavoriteProtocol,
  favoriteProtocolSchema,
  syncConnectionProtocols,
} from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/form-field';
import { useTranslation } from '@/lib/i18n';
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
  const selected = connectionProtocols(connection);
  const locked = endpoint ? presetProtocolForUrl(endpoint.baseUrl) : undefined;
  // Preset URLs speak one protocol; custom gateways can carry several on the same base URL.
  const fixedProtocol = !!locked && selected.length === 1 && selected[0] === locked;
  const error = fieldErrors[`${connection.id}-protocol`];
  const showEditor = (!fixedProtocol && editing) || !!error;
  const toggle = (protocol: FavoriteProtocol, checked: boolean) => {
    const next = checked ? [...selected, protocol] : selected.filter((value) => value !== protocol);
    if (!next.length) {
      return;
    }
    onChange(syncConnectionProtocols(next));
  };
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {!showEditor ? (
            <p className="text-xs font-medium">
              {selected
                .map((protocol) => t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[protocol]}`))
                .join(' · ')}
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
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('favorites.protocol')}</legend>
          <p className="text-xs text-muted-foreground">{t('favorites.protocolMultiHint')}</p>
          <div className="flex flex-wrap gap-3">
            {favoriteProtocolSchema.options.map((protocol) => {
              const required = locked === protocol;
              return (
                <label key={protocol} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={selected.includes(protocol)}
                    disabled={required || (selected.length === 1 && selected[0] === protocol)}
                    onCheckedChange={(value) => toggle(protocol, value === true)}
                  />
                  {t(`favorites.protocolOptions.${PROTOCOL_LABEL_KEYS[protocol]}`)}
                </label>
              );
            })}
          </div>
          <FieldError id={`${connection.id}-protocol`}>{error}</FieldError>
        </fieldset>
      ) : null}
    </div>
  );
}
