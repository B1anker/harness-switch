import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { Loader2, Network, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { controlProps, FieldError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { ConnectionSettings } from './connection-settings';
import { FavoriteSelect } from './fields';
import { presetProtocolForUrl } from './preset-connections';

export function ConnectionCard({
  connection,
  index,
  disabled,
  error,
  fieldErrors = {},
  modelHints,
  onAddProvider,
  onChange,
  onRemove,
}: {
  connection: FavoriteConnection;
  index: number;
  disabled: boolean;
  /** Card-level validation message (cross-field or duplicate rules). */
  error?: string;
  /** Field-level validation messages, keyed by `FormField` id. */
  fieldErrors?: Record<string, string>;
  /** Curated model candidates from a preset, merged with the live catalog. */
  modelHints?: string[];
  /** Opens the vault while preserving the current template draft. */
  onAddProvider?(): void;
  onChange(patch: Partial<FavoriteConnection>): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers) ?? [];
  const catalog = useAppStore(
    (state) => state.favoriteCatalogs[`${connection.providerId}/${connection.endpointKey}`],
  );
  const load = useAppStore((state) => state.loadFavoriteCatalog);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  /** Endpoint pairs already auto-fetched this mount, so failures do not loop. */
  const attempted = useRef('');
  const provider = providers.find((item) => item.id === connection.providerId);
  const title =
    connection.label || provider?.name || t('favorites.channelNumber', { count: index + 1 });
  const labelId = `${connection.id}-label`;
  const labelError = fieldErrors[labelId];
  const choices = providers.flatMap((item) =>
    item.endpoints.map((endpoint) => ({
      value: `${item.id}/${endpoint.key}`,
      label: `${item.name} · ${endpoint.label || endpoint.key}`,
      providerId: item.id,
      endpointKey: endpoint.key,
      protocol: presetProtocolForUrl(endpoint.baseUrl),
    })),
  );
  const fetchCatalog = async () => {
    const currentRequest = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      await load(connection.providerId, connection.endpointKey);
    } catch {
      if (currentRequest === request.current) {
        setFailed(true);
      }
    } finally {
      if (currentRequest === request.current) {
        setLoading(false);
      }
    }
  };
  const catalogKey = `${connection.providerId}/${connection.endpointKey}`;
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!provider || !connection.endpointKey || catalog || attempted.current === catalogKey) {
      return;
    }
    attempted.current = catalogKey;
    void fetchCatalog();
  });
  const invalid =
    !!error || Object.keys(fieldErrors).some((fieldId) => fieldId.startsWith(`${connection.id}-`));
  return (
    <Card className={cn('overflow-hidden', invalid && 'border-destructive')}>
      <div className="border-b bg-muted/25 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Network className="size-4" />
          </span>
          <Input
            {...controlProps(labelId, labelError)}
            aria-label={t('favorites.label')}
            value={connection.label}
            placeholder={provider?.name || t('favorites.channelNumber', { count: index + 1 })}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => onChange({ label: event.target.value })}
            className="h-auto w-auto min-w-24 max-w-56 flex-none border-transparent bg-transparent px-0 py-0 font-semibold text-sm shadow-none [field-sizing:content] hover:border-input focus-visible:border-ring/50"
          />
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t('favorites.removeChannelNamed', { name: title })}
            onClick={onRemove}
            className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <FieldError id={labelId}>{labelError}</FieldError>
      </div>
      {error ? (
        <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <fieldset disabled={disabled} className="min-w-0 space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <FavoriteSelect
              id={`${connection.id}-provider`}
              label={t('favorites.channelProvider')}
              value={
                connection.providerId ? `${connection.providerId}/${connection.endpointKey}` : ''
              }
              placeholder={t('favorites.chooseProvider')}
              options={choices}
              error={fieldErrors[`${connection.id}-provider`]}
              onChange={(value) => {
                const selected = choices.find((item) => item.value === value);
                if (selected) {
                  request.current++;
                  setLoading(false);
                  setFailed(false);
                  onChange({
                    providerId: selected.providerId,
                    endpointKey: selected.endpointKey,
                    ...(selected.protocol ? { protocol: selected.protocol } : {}),
                  });
                }
              }}
            />
            {onAddProvider ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-primary"
                disabled={disabled}
                onClick={onAddProvider}
              >
                {t('favorites.addProvider')}
              </Button>
            ) : null}
          </div>
          <div>
            <FormField
              id={`${connection.id}-model`}
              label={t('favorites.modelPicker')}
              hint={t('favorites.modelPickerHint')}
              error={fieldErrors[`${connection.id}-model`]}
            >
              {(control) => (
                <CreatableCombobox
                  key={`${connection.providerId}/${connection.endpointKey}`}
                  {...control}
                  value={connection.requestModelId}
                  options={[...new Set([...(modelHints ?? []), ...(catalog?.models ?? [])])]}
                  disabled={disabled}
                  onChange={(requestModelId) => onChange({ requestModelId })}
                  placeholder={t('favorites.modelPlaceholder')}
                  searchLabel={t('favorites.modelSearch')}
                  emptyHint={t('favorites.modelEmpty')}
                  customLabel={(value) => t('favorites.modelCustom', { value })}
                />
              )}
            </FormField>
          </div>
        </div>
        {loading ? (
          <p role="status" className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            {t('favorites.catalogLoading')}
          </p>
        ) : failed || (catalog && catalog.ok === false) ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs"
          >
            {t(
              modelHints?.length
                ? 'favorites.catalogFallbackAvailable'
                : 'favorites.catalogAutoFailed',
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-primary text-xs"
              disabled={disabled || loading}
              onClick={() => void fetchCatalog()}
            >
              {t('favorites.catalogRetry')}
            </Button>
          </p>
        ) : catalog ? (
          <p role="status" className="text-muted-foreground text-xs">
            {catalog.models?.length
              ? t('favorites.catalogCount', { count: catalog.models.length })
              : t('favorites.noCatalogManual')}
          </p>
        ) : null}
        <ConnectionSettings
          connection={connection}
          endpoint={provider?.endpoints.find((endpoint) => endpoint.key === connection.endpointKey)}
          fieldErrors={fieldErrors}
          onChange={onChange}
        />
      </fieldset>
    </Card>
  );
}
