import { catalogKey, type ToolModelsPreview } from '@seaveyon/harness-switch-shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';

export function ModelsPreview({
  preview,
  onApply,
}: {
  preview: ToolModelsPreview;
  onApply(): void;
}) {
  const { t } = useTranslation();
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
      {preview.items.map((item) => (
        <div key={item.id} className="space-y-1 text-sm">
          <p>
            {item.name} · <span className="font-mono">{item.model}</span>
          </p>
          <p className="text-xs text-muted-foreground">{item.connection}</p>
          {item.warnings.map((warning, index) => (
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
      <Disclosure title={t('toolModels.fileChanges')}>
        {preview.files.map((file) => (
          <div key={file.key} className="min-w-0 space-y-2">
            <p className="text-sm font-medium">
              {file.key} · {t(file.changed ? 'toolModels.changed' : 'toolModels.unchanged')}
            </p>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {[
                ['before', file.before],
                ['after', file.after],
              ].map(([label, content]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t(`toolModels.${label}`)}</p>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                    {content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Disclosure>
      <Button onClick={onApply}>{t('toolModels.apply')}</Button>
    </div>
  );
}
