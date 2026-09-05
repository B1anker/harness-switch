import type {
  FavoriteConnection,
  FavoritePlan,
  HarnessSummary,
} from '@seaveyon/harness-switch-shared';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { SwitchMap } from '@/components/workspace/configuration-path';
import { useTranslation } from '@/lib/i18n';
import { PreviewTabs } from './preview-tabs';

export function QuickPreview({
  connections,
  connection,
  selectedChannel,
  setChannel,
  targetsLoaded,
  reviewTab,
  setReviewTab,
  quickHarness,
  templateName,
  quickReady,
  plan,
}: {
  connections: FavoriteConnection[];
  connection?: FavoriteConnection;
  selectedChannel: string;
  setChannel(value: string): void;
  targetsLoaded: boolean;
  reviewTab: string;
  setReviewTab(value: string): void;
  quickHarness: HarnessSummary;
  templateName: string;
  quickReady: boolean;
  plan: FavoritePlan | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {connections.length > 1 ? (
        <FavoriteSelect
          id="quick-channel"
          label={t('favorites.connection')}
          placeholder={t('workspace.chooseChannel')}
          value={selectedChannel}
          options={connections.map((entry) => ({
            value: entry.id,
            label: entry.label + ' · ' + entry.requestModelId,
          }))}
          onChange={setChannel}
        />
      ) : null}
      {!connection ? (
        <p role="status">
          {t(
            connections.length
              ? 'workspace.chooseChannel'
              : targetsLoaded
                ? 'favorites.noCompatibleChannel'
                : 'workspace.checking',
          )}
        </p>
      ) : (
        <>
          <TabList
            idPrefix="quick-preview"
            label={t('favorites.reviewChanges')}
            items={[
              { id: 'route', label: t('workspace.switchMap') },
              { id: 'diff', label: t('workspace.fileDiffTab') },
            ]}
            value={reviewTab}
            onChange={setReviewTab}
            className="flex gap-2"
            tabClassName="px-4 py-2 text-sm"
          >
            {(item) => item.label}
          </TabList>
          <TabPanel
            idPrefix="quick-preview"
            value={reviewTab}
            className="min-h-0 flex-1 overflow-auto"
          >
            {reviewTab === 'route' ? (
              <SwitchMap
                connection={connection}
                harness={quickHarness}
                templateName={templateName}
              />
            ) : quickReady && plan ? (
              <PreviewTabs items={plan.items} />
            ) : (
              <p role="status">{t('activate.loading')}</p>
            )}
          </TabPanel>
        </>
      )}
    </>
  );
}
