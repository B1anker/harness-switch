import { catalogKey } from '@seaveyon/harness-switch-shared';
import { HarnessIcon } from '@/components/harness-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';
import type { ApplyResult } from './use-apply-workflow';

export function OperationResult({ results }: { results: ApplyResult[] }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('favorites.results')}
      className="h-full space-y-4 overflow-y-auto p-6 sm:px-8"
    >
      {results.map((item) => {
        const succeeded = item.status === 'applied' || item.status === 'unchanged';
        const status = !succeeded
          ? item.status
          : item.mode === 'save'
            ? item.status === 'unchanged'
              ? 'savedUnchanged'
              : 'saved'
            : item.status === 'unchanged'
              ? 'activatedUnchanged'
              : 'activated';
        return (
          <article key={item.harness} className="space-y-3 rounded-xl border bg-card p-4">
            <header className="flex flex-wrap items-center gap-3">
              <HarnessIcon id={item.harness} className="size-6" />
              <h3 className="min-w-0 flex-1 break-words font-semibold">
                {t(`favorites.toolNames.${item.harness}`)} · {item.profile}
              </h3>
              <Badge variant={succeeded ? 'secondary' : 'destructive'}>
                {t(`favorites.resultStatus.${status}`)}
              </Badge>
            </header>
            <p className="text-sm text-muted-foreground">
              {t(
                succeeded
                  ? item.mode === 'save'
                    ? 'favorites.resultSavedHint'
                    : 'favorites.resultActivatedHint'
                  : item.status === 'failed'
                    ? 'favorites.resultFailedHint'
                    : 'favorites.resultSkippedHint',
              )}
            </p>
            {item.code ? (
              <Alert variant={succeeded ? 'warning' : 'destructive'}>
                {t(catalogKey(item.code))}
              </Alert>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
