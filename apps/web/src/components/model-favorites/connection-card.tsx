import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import { Loader2, Network, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { ChannelOverrides } from './channel-overrides';
import { FavoriteSelect } from './fields';

export function ConnectionCard({
  favorite,
  connection,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  favorite: FavoriteInput;
  connection: FavoriteConnection;
  index: number;
  disabled: boolean;
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
  const [error, setError] = useState('');
  const request = useRef(0);
  const provider = providers.find((item) => item.id === connection.providerId);
  const title =
    connection.label || provider?.name || t('favorites.channelNumber', { count: index + 1 });
  const choices = providers.flatMap((item) =>
    item.endpoints.map((endpoint) => ({
      value: `${item.id}/${endpoint.key}`,
      label: `${item.name} · ${endpoint.label || endpoint.key}`,
      providerId: item.id,
      endpointKey: endpoint.key,
    })),
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b bg-muted/25 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Network className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold">{title}</h4>
          <p className="text-xs text-muted-foreground">{t('favorites.channelHint')}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t('favorites.removeChannelNamed', { name: title })}
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <fieldset disabled={disabled} className="min-w-0 space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <FavoriteSelect
            id={`${connection.id}-provider`}
            label={t('favorites.channelProvider')}
            value={
              connection.providerId ? `${connection.providerId}/${connection.endpointKey}` : ''
            }
            placeholder={t('favorites.chooseProvider')}
            options={choices}
            onChange={(value) => {
              const selected = choices.find((item) => item.value === value);
              if (selected) {
                request.current++;
                setLoading(false);
                setError('');
                onChange({ providerId: selected.providerId, endpointKey: selected.endpointKey });
              }
            }}
          />
          <FavoriteSelect
            id={`${connection.id}-protocol`}
            label={t('favorites.protocol')}
            value={connection.protocol}
            options={['openai-chat', 'openai-responses', 'anthropic-messages'].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(protocol) =>
              onChange({ protocol: protocol as FavoriteConnection['protocol'] })
            }
          />
        </div>
        <div className="relative pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="absolute -top-1 right-0 h-7 gap-1.5 px-1.5 text-xs text-primary"
            disabled={disabled || loading || !provider || !connection.endpointKey}
            title={t('favorites.catalog')}
            onClick={async () => {
              const currentRequest = ++request.current;
              setLoading(true);
              setError('');
              try {
                await load(connection.providerId, connection.endpointKey);
              } catch (cause) {
                if (currentRequest === request.current) {
                  setError(lineText(t, errorLine(cause)));
                }
              } finally {
                if (currentRequest === request.current) {
                  setLoading(false);
                }
              }
            }}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t(
              loading
                ? 'favorites.catalogLoading'
                : catalog
                  ? 'favorites.catalogRefresh'
                  : 'favorites.catalogLoad',
            )}
          </Button>
          <FormField
            id={`${connection.id}-model`}
            label={t('favorites.modelPicker')}
            labelClassName="pr-28"
            hint={t('favorites.modelPickerHint')}
          >
            {(control) => (
              <CreatableCombobox
                key={`${connection.providerId}/${connection.endpointKey}`}
                {...control}
                value={connection.requestModelId}
                options={catalog?.models ?? []}
                disabled={disabled}
                onChange={(requestModelId) => onChange({ requestModelId })}
                placeholder={t('favorites.modelPlaceholder')}
                searchLabel={t('favorites.modelSearch')}
                emptyHint={t('favorites.modelEmpty')}
                customLabel={(value) => t('favorites.modelCustom', { value })}
              />
            )}
          </FormField>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : catalog ? (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {catalog.models?.length
                ? t('favorites.catalogCount', { count: catalog.models.length })
                : t('favorites.noCatalogManual')}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 border-t pt-2">
          <Disclosure title={t('favorites.channelName')}>
            <FormField id={`${connection.id}-label`} label={t('favorites.label')}>
              {(control) => (
                <Input
                  {...control}
                  value={connection.label}
                  maxLength={120}
                  onChange={(event) => onChange({ label: event.target.value })}
                />
              )}
            </FormField>
          </Disclosure>
          <ChannelOverrides favorite={favorite} connection={connection} onChange={onChange} />
        </div>
      </fieldset>
    </Card>
  );
}
