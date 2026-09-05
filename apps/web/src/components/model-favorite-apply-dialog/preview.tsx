import { catalogKey, type FavoritePlanItem } from '@seaveyon/harness-switch-shared';
import { FileCode2 } from 'lucide-react';
import { ConfigDiffs } from '@/components/config-diff';
import { HarnessIcon } from '@/components/harness-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';

export function FavoritePreview({ item }: { item: FavoritePlanItem }) {
  const { t } = useTranslation();
  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex items-center gap-3 border-b p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/30">
          <HarnessIcon id={item.harness} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t(`favorites.toolNames.${item.harness}`)}</h3>
          <p className="truncate text-xs text-muted-foreground">{item.profile}</p>
        </div>
        <Badge variant="secondary">
          {t(item.existing ? 'favorites.updateProfile' : 'favorites.newProfile')}
        </Badge>
      </header>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="break-all font-mono text-sm font-medium">
            {item.projection.projection.model}
          </p>
          <Badge variant="outline">{t(`favorites.modeLabel.${item.mode}`)}</Badge>
        </div>
        {item.diff.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('favorites.parameter')}</th>
                  <th className="px-3 py-2 font-medium">{t('favorites.before')}</th>
                  <th className="px-3 py-2 font-medium">{t('favorites.after')}</th>
                </tr>
              </thead>
              <tbody>
                {item.diff.map((diff) => (
                  <tr key={diff.field} className="border-t">
                    <td className="px-3 py-2 font-mono">{diff.field}</td>
                    <td className="max-w-60 break-all px-3 py-2 text-muted-foreground">
                      {diff.before ?? '—'}
                    </td>
                    <td className="max-w-60 break-all bg-primary/[0.025] px-3 py-2 font-medium">
                      {diff.after ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('favorites.noParameterChanges')}</p>
        )}
        {item.projection.notRepresented.length ? (
          <Alert variant="warning">
            {t('favorites.notRepresented')}:{' '}
            {item.projection.notRepresented.map((field) => t(`favorites.${field}`)).join(', ')}
          </Alert>
        ) : null}
        {[...item.projection.warnings, ...item.projection.blockers].map((warning, index) => (
          <Alert key={`${warning.code}-${index}`} variant="warning">
            {t(catalogKey(warning.code))}
          </Alert>
        ))}
        <Disclosure title={t('favorites.mappingDetails')}>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {Object.entries(item.resolved.sources).map(([field, source]) => (
              <div key={field} className="flex justify-between gap-2 rounded-lg bg-muted/40 p-2">
                <dt>{t(`favorites.${field}`)}</dt>
                <dd className="text-muted-foreground">
                  {t(
                    source === 'favorite'
                      ? 'favorites.inherited'
                      : source === 'connection'
                        ? 'favorites.overridden'
                        : 'favorites.unknown',
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {item.preservedFields.length ? (
            <p className="text-xs text-muted-foreground">
              {t('favorites.preserved')}: {item.preservedFields.join(', ')}
            </p>
          ) : null}
          {Object.entries(item.projection.rendererDefaults).map(([field, value]) => (
            <p key={field} className="text-xs text-muted-foreground">
              {t('favorites.rendererDefault')}: {field} = {value}
            </p>
          ))}
        </Disclosure>
        {item.nativeFiles.length ? (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileCode2 className="size-4" />
              {t('favorites.fileDetails')}
            </div>
            <p className="text-xs text-muted-foreground">{t('favorites.redactedDiffHint')}</p>
            <ConfigDiffs
              intent="apply"
              files={item.nativeFiles.map((file) => ({
                path: file.key,
                existed: file.before !== null,
                currentContent: file.before,
                content: file.after,
              }))}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('favorites.saveOnlyHint')}
          </p>
        )}
      </div>
    </article>
  );
}
