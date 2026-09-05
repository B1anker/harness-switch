import { catalogKey, type FavoritePlanItem } from '@seaveyon/harness-switch-shared';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
export function FavoritePreview({ item }: { item: FavoritePlanItem }) {
  const { t } = useTranslation();
  return (
    <section key={item.harness} className="space-y-2 rounded-xl border p-3">
      <h3 className="font-semibold">
        {item.harness} / {item.profile}
      </h3>
      <p>
        {t(`favorites.${item.mode}`)} · {item.projection.projection.model}
      </p>
      <Disclosure title={t('favorites.changeDetails')}>
        <p>
          {t('favorites.authentication')}: {item.authMode}
        </p>
        <p>
          {t('favorites.liveState')}: {item.liveState}
        </p>
        {item.preservedFields.length ? (
          <p>
            {t('favorites.preserved')}: {item.preservedFields.join(', ')}
          </p>
        ) : null}
        {Object.entries(item.resolved.sources).map(([field, source]) => (
          <p key={field} className="text-xs text-muted-foreground">
            {t(`favorites.${field}`)}:{' '}
            {t(
              source === 'favorite'
                ? 'favorites.inherited'
                : source === 'connection'
                  ? 'favorites.overridden'
                  : 'favorites.unknown',
            )}
          </p>
        ))}
        {item.diff.map((diff) => (
          <p key={diff.field} className="break-all font-mono text-xs">
            {diff.field}: {diff.before ?? '∅'} → {diff.after ?? '∅'}
          </p>
        ))}
        {Object.entries(item.projection.rendererDefaults).map(([field, value]) => (
          <p key={field}>
            {t('favorites.rendererDefault')}: {field} = {value}
          </p>
        ))}
      </Disclosure>
      {item.projection.notRepresented.length ? (
        <p>
          {t('favorites.notRepresented')}: {item.projection.notRepresented.join(', ')}
        </p>
      ) : null}
      {[...item.projection.warnings, ...item.projection.blockers].map((warning, index) => (
        <p key={`${warning.code}-${index}`} className="text-amber-700">
          {t(catalogKey(warning.code))}
        </p>
      ))}
      <p>
        {t('favorites.nativeFiles')}:{' '}
        {item.nativeFiles.map((file) => file.key).join(', ') || t('favorites.none')}
      </p>
      {item.nativeFiles.length ? (
        <Disclosure title={t('favorites.fileDetails')}>
          {item.nativeFiles.map((file) => (
            <div key={file.key} className="grid gap-2 sm:grid-cols-2">
              <pre className="max-h-64 overflow-auto rounded border p-2 text-xs">
                {file.before ?? '∅'}
              </pre>
              <pre className="max-h-64 overflow-auto rounded border p-2 text-xs">
                {file.after ?? '∅'}
              </pre>
            </div>
          ))}
        </Disclosure>
      ) : null}
    </section>
  );
}
