import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
import type { ProfileGroup } from '@/lib/profile-groups';
import { useAppStore } from '@/stores/app-store';

export function CollectionProfileCard({
  group,
  harness,
  onActivate,
  onOpenTemplate,
}: {
  group: ProfileGroup;
  harness: HarnessSummary;
  onActivate(profile: ProfilePublic): void;
  onOpenTemplate?(id: string): void;
}) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const favorite = favorites?.find((entry) => entry.id === group.favoriteId);
  const [chosen, setChosen] = useState('');
  const selected = group.profiles.find((profile) => profile.name === chosen) ?? group.selected;
  const active =
    !harness.active?.official &&
    group.profiles.some((profile) => profile.name === harness.active?.name);
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium">{favorite?.name ?? group.selected.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('favorites.scheme.collectionProfile', { count: group.profiles.length })}
          </p>
        </div>
        {active ? <Badge>{t('workspace.activeNow')}</Badge> : null}
      </div>
      <FavoriteSelect
        id={`collection-default-${harness.id}-${group.favoriteId}`}
        label={t('favorites.scheme.startModel')}
        value={selected.name}
        options={group.profiles.map((profile) => ({
          value: profile.name,
          label: profile.model,
          description: profile.baseUrl,
        }))}
        onChange={setChosen}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!harness.active?.official && harness.active?.name === selected.name}
          onClick={() => onActivate(selected)}
        >
          {t('favorites.scheme.useCollection')}
        </Button>
        <Button
          variant="ghost"
          disabled={!onOpenTemplate || !group.favoriteId}
          onClick={() => onOpenTemplate?.(group.favoriteId!)}
        >
          {t('favorites.scheme.manageCollection')}
        </Button>
      </div>
      <Disclosure title={t('favorites.scheme.selectedCount', { count: group.profiles.length })}>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {group.profiles.map((profile) => (
            <div key={profile.name} className="min-w-0 text-sm">
              <p className="break-all font-mono">{profile.model}</p>
              <p className="break-all text-xs text-muted-foreground">{profile.baseUrl}</p>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
