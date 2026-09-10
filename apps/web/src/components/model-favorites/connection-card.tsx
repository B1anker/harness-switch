import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { ChevronDown, Loader2, Network, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { controlProps, FieldError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { ConnectionSettings } from './connection-settings';
import { FavoriteSelect } from './fields';
import { presetProtocolForUrl } from './preset-connections';
import { useConnectionCatalog } from './use-connection-catalog';

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
  models,
  onModelsChange,
  onModelSettings,
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
  models?: FavoriteConnection[];
  onModelsChange?(models: string[]): void;
  onModelSettings?(id: string): void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(!!models && index > 0 && !!connection.requestModelId);
  const providers = useAppStore((state) => state.providers) ?? [];
  const provider = providers.find((item) => item.id === connection.providerId);
  const { catalog, loading, failed, retry } = useConnectionCatalog(
    connection.providerId,
    connection.endpointKey,
    !!provider,
  );
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
  const invalid =
    !!error || Object.keys(fieldErrors).some((fieldId) => fieldId.startsWith(`${connection.id}-`));
  return (
    <Card className={cn('overflow-hidden', invalid && 'border-destructive')}>
      <div className={cn('bg-muted/25 px-4 py-2', (!collapsed || invalid) && 'border-b')}>
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
          {models ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-2"
              aria-expanded={!collapsed}
              aria-label={t('favorites.scheme.toggleConnection', { name: title })}
              onClick={() => setCollapsed(!collapsed)}
            >
              {t('favorites.scheme.selectedCount', {
                count: models.filter((model) => model.requestModelId).length,
              })}
              <ChevronDown
                className={cn('size-4 transition-transform', !collapsed && 'rotate-180')}
              />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t('favorites.removeChannelNamed', { name: title })}
            onClick={onRemove}
            className={cn(
              'shrink-0 text-muted-foreground hover:text-destructive',
              !models && 'ml-auto',
            )}
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
      <fieldset
        hidden={collapsed && !invalid}
        disabled={disabled}
        className="min-w-0 space-y-3 p-4"
      >
        <div className={cn('grid gap-4', !models && 'sm:grid-cols-2')}>
          <div className={cn('space-y-2', models && 'relative')}>
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
                className={cn(
                  'h-auto px-0 text-primary',
                  models && 'absolute right-0 top-0 m-0 py-0 text-xs',
                )}
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
              label={t(models ? 'favorites.scheme.modelMulti' : 'favorites.modelPicker')}
              hint={models ? undefined : t('favorites.modelPickerHint')}
              error={fieldErrors[`${connection.id}-model`]}
            >
              {(control) => (
                <CreatableCombobox
                  key={`${connection.providerId}/${connection.endpointKey}`}
                  {...control}
                  value={models ? '' : connection.requestModelId}
                  selectedValues={models?.map((model) => model.requestModelId).filter(Boolean)}
                  options={[...new Set([...(modelHints ?? []), ...(catalog?.models ?? [])])]}
                  disabled={disabled}
                  onChange={(requestModelId) => {
                    if (models && onModelsChange) {
                      const selected = models.map((model) => model.requestModelId).filter(Boolean);
                      onModelsChange(
                        selected.includes(requestModelId)
                          ? selected.filter((model) => model !== requestModelId)
                          : [...selected, requestModelId],
                      );
                    } else {
                      onChange({ requestModelId });
                    }
                  }}
                  placeholder={t('favorites.modelPlaceholder')}
                  searchLabel={t('favorites.modelSearch')}
                  emptyHint={t('favorites.modelEmpty')}
                  customLabel={(value) => t('favorites.modelCustom', { value })}
                />
              )}
            </FormField>
            {models?.some((model) => model.requestModelId) ? (
              <div className="mt-3 rounded-lg bg-primary/[0.035] p-2">
                {models
                  .filter((model) => model.requestModelId)
                  .map((model) => (
                    <div
                      key={model.id}
                      className="flex min-h-8 min-w-0 items-center gap-3 px-2 py-0.5"
                    >
                      <Checkbox
                        aria-label={model.requestModelId}
                        checked
                        disabled={disabled}
                        onCheckedChange={() =>
                          onModelsChange?.(
                            models
                              .filter((item) => item.id !== model.id)
                              .map((item) => item.requestModelId)
                              .filter(Boolean),
                          )
                        }
                      />
                      <span className="min-w-0 break-all font-mono text-sm">
                        {model.requestModelId}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-7 shrink-0"
                        aria-label={t('favorites.scheme.modelSettings', {
                          model: model.requestModelId,
                        })}
                        onClick={() => onModelSettings?.(model.id)}
                      >
                        <SlidersHorizontal className="size-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            ) : null}
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
              onClick={() => void retry()}
            >
              {t('favorites.catalogRetry')}
            </Button>
          </p>
        ) : catalog && !models ? (
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
