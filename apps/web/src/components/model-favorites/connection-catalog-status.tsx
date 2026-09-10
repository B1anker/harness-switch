import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

export function ConnectionCatalogStatus({
  catalog,
  loading,
  failed,
  disabled,
  hasHints,
  onRefresh,
}: {
  catalog?: ProbeResult;
  loading: boolean;
  failed: boolean;
  disabled: boolean;
  hasHints: boolean;
  onRefresh(): void;
}) {
  const { t } = useTranslation();
  const error = failed || catalog?.ok === false;
  return (
    <div className="mt-1 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p role="status" className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {loading
          ? t('favorites.catalogLoading')
          : error
            ? t(hasHints ? 'favorites.catalogFallbackAvailable' : 'favorites.catalogAutoFailed')
            : catalog
              ? catalog.models?.length
                ? t('favorites.catalogCount', { count: catalog.models.length })
                : t('favorites.noCatalogManual')
              : null}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 gap-1.5 px-1.5 text-primary text-xs"
        disabled={disabled || loading}
        onClick={onRefresh}
      >
        <RefreshCw className="size-3.5" />
        {t(error ? 'favorites.catalogRetry' : 'favorites.catalogRefresh')}
      </Button>
    </div>
  );
}
