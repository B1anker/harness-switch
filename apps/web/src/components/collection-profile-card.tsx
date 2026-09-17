import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Play, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { harnessWords } from '@/lib/harness-words';
import { useTranslation } from '@/lib/i18n';
import type { ProfileGroup } from '@/lib/profile-groups';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

/**
 * One template applied to a collection tool (Kimi, DSH) lands as one profile per model.
 * They are listed as a single row shaped like `ProfileRow`, with the start model chosen
 * inline, so the tool page reads the same as the single-profile tools.
 */
export function CollectionProfileCard({
  group,
  harness,
  switching,
  onActivate,
  onOpenTemplate,
}: {
  group: ProfileGroup;
  harness: HarnessSummary;
  switching?: boolean;
  onActivate(profile: ProfilePublic): void;
  onOpenTemplate?(id: string): void;
}) {
  const { t } = useTranslation();
  const words = harnessWords(harness.id);
  const favorites = useAppStore((state) => state.favorites);
  const favorite = favorites?.find((entry) => entry.id === group.favoriteId);
  const [chosen, setChosen] = useState('');
  const selected = group.profiles.find((profile) => profile.name === chosen) ?? group.selected;
  const activeName = harness.active?.official ? undefined : harness.active?.name;
  const active = group.profiles.some((profile) => profile.name === activeName);
  const selectedActive = selected.name === activeName;
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card px-4 py-4 shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)] transition-[border-color,background-color,box-shadow] sm:flex-row sm:items-center sm:justify-between',
        active
          ? 'border-primary/20 bg-primary/[0.035] shadow-[0_12px_30px_-24px_rgb(99_91_255/0.35)]'
          : 'hover:border-primary/15 hover:bg-card/85',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'mt-2 size-2 shrink-0 rounded-full',
            active ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{favorite?.name ?? group.selected.name}</p>
            {active ? <Badge>{t(words.appliedBadge)}</Badge> : null}
            <Badge variant="outline">
              {t('favorites.scheme.collectionProfile', { count: group.profiles.length })}
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {selected.baseUrl}
          </p>
          <p
            title={selected.model}
            className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
          >
            {selected.model}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 self-end sm:self-auto">
        <Select value={selected.name} onValueChange={setChosen}>
          <SelectTrigger
            aria-label={t('favorites.scheme.startModel')}
            className="h-9 w-56 font-mono text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {group.profiles.map((profile) => (
              <SelectItem key={profile.name} value={profile.name} className="font-mono text-xs">
                {profile.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={selectedActive ? 'secondary' : 'outline'}
          disabled={selectedActive}
          onClick={() => onActivate(selected)}
        >
          {!selectedActive ? <Play /> : null}
          {t(
            switching
              ? selectedActive
                ? 'workspace.activeNow'
                : 'workspace.useConfiguration'
              : selectedActive
                ? words.appliedBadge
                : words.apply,
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('favorites.scheme.manageCollection')}
          title={t('favorites.scheme.manageCollection')}
          disabled={!onOpenTemplate || !group.favoriteId}
          onClick={() => onOpenTemplate?.(group.favoriteId!)}
        >
          <Sparkles />
        </Button>
      </div>
    </div>
  );
}
