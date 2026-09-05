import {
  catalogKey,
  type FavoriteOperation,
  type FavoritePlanItem,
} from '@seaveyon/harness-switch-shared';
import { useId, useState } from 'react';
import { HarnessIcon } from '@/components/harness-icon';
import { Alert } from '@/components/ui/alert';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { FavoritePreview } from './preview';

export function PreviewTabs({
  items,
  history = [],
}: {
  items: FavoritePlanItem[];
  history?: FavoriteOperation[];
}) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const [selected, setSelected] = useState(items[0]?.harness);
  const active = items.find((item) => item.harness === selected) ?? items[0];
  if (!active) {
    return null;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <TabList
        label={t('favorites.targetTools')}
        idPrefix={idPrefix}
        items={items.map((item) => ({ ...item, id: item.harness }))}
        value={active.harness}
        onChange={setSelected}
        className="flex shrink-0 gap-2 overflow-x-auto border-b pb-3"
        tabClassName="gap-2 px-4 py-3 text-sm font-medium"
      >
        {(item) => (
          <>
            <HarnessIcon id={item.harness} className="size-5" />
            {t(`favorites.toolNames.${item.harness}`)}
          </>
        )}
      </TabList>
      <TabPanel
        key={active.harness}
        idPrefix={idPrefix}
        value={active.harness}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
      >
        {history.flatMap((entry) =>
          entry.items
            .filter((item) => item.harness === active.harness)
            .map((item) => (
              <Alert
                key={entry.requestId}
                variant={item.status === 'failed' ? 'destructive' : 'muted'}
              >
                <span role="status">
                  {item.profile}: {t(`favorites.${item.status}`)}{' '}
                  {item.code ? t(catalogKey(item.code)) : ''}
                </span>
              </Alert>
            )),
        )}
        <FavoritePreview item={active} />
      </TabPanel>
    </div>
  );
}
