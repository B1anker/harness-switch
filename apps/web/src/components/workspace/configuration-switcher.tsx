import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Check, Plus, Settings2, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActivateDialog } from '@/components/activate-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { SwitchPanel } from './switch-panel';

type Source = 'profiles' | 'favorites';

export function ConfigurationSwitcher({
  harness,
  onNewProfile,
  onManageFavorites,
}: {
  harness: HarnessSummary;
  onNewProfile(): void;
  onManageFavorites(): void;
}) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const error = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const [source, setSource] = useState<Source>('profiles');
  const [favoriteId, setFavoriteId] = useState('');
  const [activating, setActivating] = useState<ProfilePublic | null>(null);
  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);
  const favorite = favorites?.find((entry) => entry.id === favoriteId);
  const profiles = harness.profiles.filter(
    (profile) => profile.name !== harness.official?.linkedProfileName,
  );
  return (
    <section className="workspace-surface space-y-6 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="workspace-eyebrow">{t('workspace.switcherEyebrow')}</p>
          <h3 className="mt-2 text-xl font-semibold">
            {t('workspace.switcherTitle', { name: harness.label })}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t('workspace.switcherHint')}
          </p>
        </div>
      </div>
      <SegmentedControl
        options={['profiles', 'favorites'] as const}
        value={source}
        onChange={setSource}
        className="max-w-md"
      >
        {(item) => (
          <>
            {item === 'profiles' ? <Settings2 /> : <Star />}
            {t(item === 'profiles' ? 'workspace.existingSource' : 'workspace.favoriteSource')}
          </>
        )}
      </SegmentedControl>
      {error ? <Alert>{lineText(t, error)}</Alert> : null}
      {source === 'profiles' ? (
        <div className="space-y-3">
          {profiles.length ? (
            profiles.map((profile) => {
              const active = !harness.active?.official && harness.active?.name === profile.name;
              return (
                <div
                  key={profile.name}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      {profile.name}
                      {active ? <Check className="size-4 text-primary" /> : null}
                    </span>
                    <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                      {profile.model || t('harness.currentInactive')}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={active ? 'secondary' : 'outline'}
                    disabled={active}
                    onClick={() => setActivating(profile)}
                  >
                    {active ? t('workspace.activeNow') : t('workspace.useConfiguration')}
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              {t('workspace.noProfiles')}
            </div>
          )}
          <Button variant="link" className="px-0" onClick={onNewProfile}>
            <Plus />
            {t('workspace.newConfiguration')}
          </Button>
        </div>
      ) : loading && !favorites ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('favorites.loading')}
        </p>
      ) : favorites?.length ? (
        <div className="space-y-6">
          <FormField id="switcher-favorite" label={t('workspace.chooseFavorite')}>
            {(control) => (
              <CreatableCombobox
                {...control}
                value={favorite?.id ?? ''}
                options={favorites.map((entry) => entry.id)}
                getLabel={(id) => favorites.find((entry) => entry.id === id)?.name ?? id}
                onChange={setFavoriteId}
                placeholder={t('workspace.pickModel')}
                searchLabel={t('favorites.search')}
                emptyHint={t('workspace.noMatches')}
              />
            )}
          </FormField>
          {favorite ? (
            <SwitchPanel
              key={favorite.id + '/' + favorite.revision}
              favorite={favorite}
              harness={harness}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('workspace.pickHint')}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-6">
          <p className="text-sm text-muted-foreground">{t('workspace.noFavorites')}</p>
          <Button variant="link" className="mt-2 px-0" onClick={onManageFavorites}>
            <Star />
            {t('workspace.manageFavorites')}
          </Button>
        </div>
      )}
      {activating ? (
        <ActivateDialog
          harness={harness}
          profile={activating}
          open
          onOpenChange={(open) => {
            if (!open) {
              setActivating(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}
