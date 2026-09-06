import type { ProviderPreset } from '@seaveyon/harness-switch-shared';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { FavoriteSelect } from '../fields';

export function PresetProviderForm({
  preset,
  name,
  setName,
  apiKey,
  setApiKey,
  endpointKey,
  setEndpointKey,
  busy,
  error,
  onBack,
  onCreate,
}: {
  preset: ProviderPreset;
  name: string;
  setName(value: string): void;
  apiKey: string;
  setApiKey(value: string): void;
  endpointKey: string;
  setEndpointKey(value: string): void;
  busy: boolean;
  error: string;
  onBack(): void;
  onCreate(): void;
}) {
  const { t } = useTranslation();
  const selectedEndpoint = preset.endpoints.find((endpoint) => endpoint.key === endpointKey);
  return (
    <fieldset disabled={busy} className="grid gap-4">
      <FormField id="preset-provider-name" label={t('vault.name')}>
        {(control) => (
          <Input
            {...control}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </FormField>
      <FormField id="preset-provider-key" label={t('vault.apiKey')}>
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
      </FormField>
      {preset.getKeyUrl ? (
        <a
          className="text-sm text-primary underline underline-offset-4"
          href={preset.getKeyUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('favorites.presets.getKey')}
        </a>
      ) : null}
      {preset.endpoints.length > 1 ? (
        <FavoriteSelect
          id="preset-endpoint"
          label={t('favorites.presets.chooseEndpoint')}
          hint={t('favorites.presets.endpointHint')}
          value={endpointKey}
          options={preset.endpoints.map((endpoint) => ({
            value: endpoint.key,
            label: t(
              endpoint.protocol === 'anthropic-messages'
                ? 'favorites.protocolOptions.anthropicMessages'
                : endpoint.protocol === 'openai-responses'
                  ? 'favorites.protocolOptions.openaiResponses'
                  : 'favorites.protocolOptions.openaiChat',
            ),
            description: endpoint.baseUrl,
          }))}
          onChange={setEndpointKey}
        />
      ) : null}
      <p className="break-all text-muted-foreground text-xs">
        {t('favorites.presets.baseUrl')}: {selectedEndpoint?.baseUrl}
      </p>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t('favorites.presets.back')}
        </Button>
        <Button disabled={busy || !name.trim() || !apiKey.trim()} onClick={onCreate}>
          {t('favorites.presets.createProvider')}
        </Button>
      </div>
    </fieldset>
  );
}
