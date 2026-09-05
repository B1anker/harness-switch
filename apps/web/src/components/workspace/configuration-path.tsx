import type { FavoriteConnection, HarnessId } from '@seaveyon/harness-switch-shared';
import { ArrowRight, Box, Network } from 'lucide-react';
import { HarnessIcon } from '@/components/harness-icon';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';

export function ConfigurationPath({
  connection,
  harness,
  name,
}: {
  connection: FavoriteConnection;
  harness: HarnessId;
  name: string;
}) {
  const { t } = useTranslation();
  const provider = useAppStore((state) =>
    state.providers?.find((entry) => entry.id === connection.providerId),
  );
  return (
    <section aria-label={t('workspace.relationship')} className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {t('workspace.relationship')}
      </p>
      <ol className="configuration-path">
        <li className="path-node">
          <Network className="size-5 text-primary" />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{t('workspace.provider')}</span>
            <strong className="block break-words text-sm">
              {provider?.name ?? t('workspace.missingProvider')}
            </strong>
          </span>
        </li>
        <li aria-hidden className="path-arrow">
          <ArrowRight />
        </li>
        <li className="path-node path-node-focus">
          <Box className="size-5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              {t('favorites.modelPicker')}
            </span>
            <strong className="block break-all font-mono text-xs">
              {connection.requestModelId}
            </strong>
          </span>
        </li>
        <li aria-hidden className="path-arrow">
          <ArrowRight />
        </li>
        <li className="path-node">
          <HarnessIcon id={harness} />
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{t('workspace.tool')}</span>
            <strong className="block break-words text-sm">{name}</strong>
          </span>
        </li>
      </ol>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('workspace.relationshipHint')}
      </p>
    </section>
  );
}
