import { catalogKey, ERROR_CODES, type ToolModelsPreview } from '@seaveyon/harness-switch-shared';
import { FileCode2 } from 'lucide-react';
import { ConfigDiffs } from '@/components/config-diff';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

export function ModelsPreview({
  preview,
  onApply,
}: {
  preview: ToolModelsPreview;
  onApply?(): void;
}) {
  const { t } = useTranslation();
  const missingLevels = preview.items.filter((item) =>
    item.warnings.some((warning) => warning.code === ERROR_CODES.favoriteReasoningLevelsMissing),
  );
  const selected = preview.items.find((item) => item.id === preview.defaultItemId);
  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h4 className="font-semibold">{t('toolModels.previewTitle')}</h4>
      <p className="text-sm">
        {t('toolModels.previewCount', {
          count: preview.items.length,
          removed: preview.removed.length,
        })}
      </p>
      <p className="text-sm">
        {selected
          ? t('toolModels.defaultChanged', { name: selected.name, model: selected.model })
          : t('toolModels.keepDefault')}
      </p>
      {missingLevels.length ? (
        <Alert variant="muted">
          <p>{t('favorites.scheme.missingReasoningCount', { count: missingLevels.length })}</p>
          <p>{t(catalogKey(ERROR_CODES.favoriteReasoningLevelsMissing))}</p>
        </Alert>
      ) : null}
      {preview.items.map((item) => (
        <div key={item.id} className="space-y-1 text-sm">
          <p>
            {item.name} · <span className="font-mono">{item.model}</span>
          </p>
          <p className="text-xs text-muted-foreground">{item.connection}</p>
          {item.warnings
            .filter((warning) => warning.code !== ERROR_CODES.favoriteReasoningLevelsMissing)
            .map((warning, index) => (
              <Alert key={`${warning.code}-${index}`} variant="warning">
                {t(catalogKey(warning.code), warning.data)}
              </Alert>
            ))}
          {item.notRepresented.length ? (
            <Alert variant="warning">
              {t('toolModels.notRepresented', {
                fields: item.notRepresented.map((field) => t(`favorites.${field}`)).join(' · '),
              })}
            </Alert>
          ) : null}
        </div>
      ))}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileCode2 className="size-4" />
          {t('favorites.liveComparison')}
        </div>
        <p className="text-xs text-muted-foreground">{t('favorites.liveComparisonHint')}</p>
        <ConfigDiffs
          collapseUnchanged
          intent="apply"
          files={preview.files.map((file) => ({
            path: file.key,
            // The server hands back '' for a file that is not on disk yet.
            existed: file.before !== '',
            currentContent: file.before || null,
            content: file.after,
          }))}
        />
      </div>
      {onApply ? <Button onClick={onApply}>{t('toolModels.apply')}</Button> : null}
    </div>
  );
}
