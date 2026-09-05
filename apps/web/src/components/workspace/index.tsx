import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { ArrowRight, History, Plus, Settings2, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HarnessIcon } from '@/components/harness-icon';
import { CaptureFavorite } from '@/components/model-favorites/capture';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { FormField } from '@/components/ui/form-field';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { useI18n, useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { SwitchPanel } from './switch-panel';

export function Workspace({
  onConfigure,
  onFavorites,
  onHistory,
}: {
  onConfigure(id: HarnessId): void;
  onFavorites(): void;
  onHistory(): void;
}) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const harnesses = useAppStore((state) => state.harnesses);
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const error = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const loadHistory = useAppStore((state) => state.loadFavoriteBackups);
  const backups = useAppStore((state) => state.favoriteBackups);
  const [selected, setSelected] = useState<HarnessId>('claude');
  const [choices, setChoices] = useState<Partial<Record<HarnessId, string>>>({});
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState<{ harness: HarnessId; name: string } | null>(null);
  useEffect(() => {
    void load();
    void loadProviders();
    void loadHistory().catch(() => {});
  }, [load, loadProviders, loadHistory]);
  const harness = harnesses.find((entry) => entry.id === selected) ?? harnesses[0];
  const linked = harness?.profiles.find(
    (profile) => !harness.active?.official && profile.name === harness.active?.name,
  )?.modelFavorite?.favoriteId;
  const favoriteId = harness
    ? (choices[harness.id] ?? linked ?? (favorites?.length === 1 ? favorites[0]?.id : ''))
    : '';
  const favorite = favorites?.find((entry) => entry.id === favoriteId);
  const currentProfile = harness?.profiles.find(
    (profile) =>
      profile.name === harness.active?.name &&
      !harness.active?.official &&
      !profile.modelFavorite &&
      !profile.overriddenTargets.length &&
      profile.name !== harness.official?.linkedProfileName,
  );
  return (
    <main className="workspace-page space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="workspace-eyebrow">{t('workspace.eyebrow')}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('workspace.title')}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">{t('workspace.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={onFavorites}>
          <Star />
          {t('workspace.manageFavorites')}
        </Button>
      </div>
      {error ? <Alert>{lineText(t, error)}</Alert> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
        <TabList
          label={t('nav.switchHarness')}
          idPrefix="workspace-tool"
          orientation="vertical"
          items={harnesses}
          value={harness?.id}
          onChange={setSelected}
          className="flex flex-col gap-2"
          tabClassName="workspace-tool gap-4 px-5 py-5"
        >
          {(entry) => (
            <>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card">
                <HarnessIcon id={entry.id} className="size-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{entry.label}</span>
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {entry.active?.model ||
                    t(entry.active?.official ? 'harness.official' : 'harness.currentInactive')}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </>
          )}
        </TabList>
        {harness ? (
          <TabPanel
            idPrefix="workspace-tool"
            value={harness.id}
            className="workspace-surface min-w-0 space-y-6 p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-semibold">
                {t('workspace.switchTool', { name: harness.label })}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => onConfigure(harness.id)}>
                <Settings2 />
                {t('workspace.configureTool')}
              </Button>
            </div>
            {loading && !favorites ? (
              <p role="status">{t('favorites.loading')}</p>
            ) : favorites?.length ? (
              <>
                <FormField id="workspace-model" label={t('workspace.chooseFavorite')}>
                  {(control) => (
                    <CreatableCombobox
                      {...control}
                      value={favorite?.id ?? ''}
                      options={favorites.map((entry) => entry.id)}
                      getLabel={(id) => favorites.find((entry) => entry.id === id)?.name ?? id}
                      onChange={(id) => setChoices({ ...choices, [harness.id]: id })}
                      placeholder={t('workspace.pickModel')}
                      searchLabel={t('favorites.search')}
                      emptyHint={t('workspace.noMatches')}
                    />
                  )}
                </FormField>
                {favorite ? (
                  <SwitchPanel
                    key={`${harness.id}/${favorite.id}/${favorite.revision}`}
                    favorite={favorite}
                    harness={harness}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t('workspace.pickHint')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  <Button variant="link" className="px-0" onClick={() => setEditing(true)}>
                    <Plus />
                    {t('workspace.newFavorite')}
                  </Button>
                  {currentProfile ? (
                    <Button
                      variant="link"
                      className="px-0"
                      onClick={() =>
                        setCapturing({ harness: harness.id, name: currentProfile.name })
                      }
                    >
                      <Star />
                      {t('workspace.captureCurrent')}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="space-y-5 py-7">
                <Star className="size-9 text-primary" />
                <h4 className="text-lg font-semibold">{t('workspace.startTitle')}</h4>
                <p className="max-w-lg text-sm leading-7 text-muted-foreground">
                  {t('workspace.startHint')}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() =>
                      currentProfile
                        ? setCapturing({ harness: harness.id, name: currentProfile.name })
                        : onFavorites()
                    }
                  >
                    {t('favorites.capture')}
                    <ArrowRight />
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    {t('favorites.add')}
                  </Button>
                </div>
              </div>
            )}
          </TabPanel>
        ) : (
          <p>{t('workspace.noTools')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onHistory}
        className="workspace-history-link group flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/60 p-5 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-4">
          <History className="size-6 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold">{t('timeline.title')}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {backups[0]
                ? t('workspace.lastBackup', {
                    time: new Date(backups[0].createdAt).toLocaleString(locale),
                  })
                : t('workspace.historyHint')}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          {t('workspace.openHistory')}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" />
        </span>
      </button>
      {editing ? <FavoriteEditor onClose={() => setEditing(false)} /> : null}
      {capturing ? (
        <CaptureFavorite initialSource={capturing} onClose={() => setCapturing(null)} />
      ) : null}
    </main>
  );
}
