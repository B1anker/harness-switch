import type { FavoriteBackupPreview } from '@seaveyon/harness-switch-shared';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';

export function BackupImpact({ preview }: { preview: FavoriteBackupPreview }) {
  const { t } = useTranslation();
  const changed = preview.files.filter((file) => file.action !== 'unchanged');
  const unchanged = preview.files.filter((file) => file.action === 'unchanged');
  const label = (key: string) =>
    key.startsWith('store/') ? t(`favorites.restoreArea.${key.slice(6)}`) : key;
  return (
    <div className="space-y-3">
      <p className="font-medium">{t('favorites.restoreImpact', { count: changed.length })}</p>
      {changed.length ? (
        <ul className="divide-y rounded-lg border px-3">
          {changed.map((file) => (
            <li key={file.key} className="space-y-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{label(file.key)}</span>
                <Badge variant={file.action === 'delete' ? 'destructive' : 'secondary'}>
                  {t(`favorites.restoreAction.${file.action}`)}
                </Badge>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">{file.path}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('favorites.restoreNoChanges')}</p>
      )}
      {unchanged.length ? (
        <Disclosure title={t('favorites.restoreUnchanged', { count: unchanged.length })}>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {unchanged.map((file) => (
              <li key={file.key}>
                {label(file.key)}
                <span className="block break-all font-mono">{file.path}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
