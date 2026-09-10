import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Copy, Pencil, Play, Trash2 } from 'lucide-react';
import { FavoriteLinkStatus } from '@/components/model-favorites/link-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { configuredModel } from '@/lib/configured-model';
import { harnessWords } from '@/lib/harness-words';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function ProfileRow({
  profile,
  harness,
  active,
  switching,
  onOpenTemplate,
  onEdit,
  onCopy,
  setActivating,
  setPendingName,
}: {
  profile: ProfilePublic;
  harness: HarnessSummary;
  active: boolean;
  switching?: boolean;
  onOpenTemplate?(id: string): void;
  onEdit(profile: ProfilePublic): void;
  onCopy?(profile: ProfilePublic): void;
  setActivating(profile: ProfilePublic): void;
  setPendingName(name: string): void;
}) {
  const { t } = useTranslation();
  const words = harnessWords(harness.id);
  return (
    <div
      key={profile.name}
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
          <div className="flex items-center gap-2">
            <p className="font-medium">{profile.name}</p>
            {active ? <Badge>{t(words.appliedBadge)}</Badge> : null}
            {profile.overriddenTargets.length > 0 ? (
              <Badge variant="outline">{t('harness.manualOverride')}</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{profile.baseUrl}</p>
          {
            <p
              title={configuredModel(profile, t)}
              className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
            >
              {configuredModel(profile, t)}
            </p>
          }
          {profile.modelFavorite ? (
            <FavoriteLinkStatus profile={profile} onOpenTemplate={onOpenTemplate} />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        <Button
          size="sm"
          variant={active ? 'secondary' : 'outline'}
          onClick={() => setActivating(profile)}
          disabled={active}
        >
          {!active ? <Play /> : null}
          {t(
            switching
              ? active
                ? 'workspace.activeNow'
                : 'workspace.useConfiguration'
              : active
                ? words.appliedBadge
                : words.apply,
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('harness.edit', { name: profile.name })}
          onClick={() => onEdit(profile)}
        >
          <Pencil />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('harness.copy', { name: profile.name })}
          onClick={() => onCopy?.(profile)}
        >
          <Copy />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('harness.delete', { name: profile.name })}
          disabled={active}
          title={active ? t('harness.deleteBlocked') : undefined}
          onClick={() => setPendingName(profile.name)}
        >
          <Trash2 className={active ? undefined : 'text-destructive'} />
        </Button>
      </div>
    </div>
  );
}
