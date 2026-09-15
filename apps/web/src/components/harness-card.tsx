import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { CircleUserRound, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ActivateDialog } from '@/components/activate-dialog';
import { CollectionProfileCard } from '@/components/collection-profile-card';
import { ProfileRow } from '@/components/profile-row';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { harnessWords } from '@/lib/harness-words';
import { useTranslation } from '@/lib/i18n';
import { profileDisplayName, profileGroups } from '@/lib/profile-groups';
import { useAppStore } from '@/stores/app-store';

type HarnessCardProps = {
  harness: HarnessSummary;
  onAdd: () => void;
  onEdit: (profile: ProfilePublic) => void;
  onCopy?: (profile: ProfilePublic) => void;
  extraActions?: ReactNode;
  onOpenTemplate?: (id: string) => void;
  switching?: boolean;
};

export function HarnessCard({
  harness,
  onAdd,
  onEdit,
  onCopy,
  extraActions,
  onOpenTemplate,
  switching,
}: HarnessCardProps) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const deleteProfile = useAppStore((state) => state.deleteProfile);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [activating, setActivating] = useState<ProfilePublic | null>(null);
  const [activatingOfficial, setActivatingOfficial] = useState(false);
  const official = harness.official;
  const linkedOfficialProfile = official?.linkedProfileName
    ? harness.profiles.find((profile) => profile.name === official.linkedProfileName)
    : undefined;
  const visibleGroups = profileGroups(harness).filter(
    (group) => group.selected.name !== official?.linkedProfileName,
  );
  const pendingProfile = harness.profiles.find((profile) => profile.name === pendingName);
  const isLastDshOfficial =
    harness.id === 'dsh' &&
    pendingProfile?.extras.providerType === 'official' &&
    harness.profiles.filter((profile) => profile.extras.providerType === 'official').length === 1;
  // The stored name of the official entry is data on disk, so the display text
  // comes from the `official` flag rather than from matching the name.
  const words = harnessWords(harness.id);
  const activeName = harness.active?.official
    ? t('harness.official')
    : (profileDisplayName(
        harness.profiles.find((profile) => profile.name === harness.active?.name),
        favorites,
      ) ??
      harness.active?.name ??
      null);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/10">
        <CardContent className="p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)] sm:divide-x">
            <div className="min-w-0 sm:pr-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-primary shadow-[0_0_0_4px_rgb(99_91_255/0.1)]" />
                {t(words.applied)}
              </div>
              <CardTitle className="mt-3 truncate text-xl">
                {activeName === null
                  ? t('harness.inactive')
                  : t('harness.activeNamed', { name: activeName })}
              </CardTitle>
              <CardDescription className="mt-1">
                {activeName === null
                  ? t('harness.currentInactive')
                  : t('harness.current', { name: activeName })}
              </CardDescription>
            </div>
            <div className="min-w-0 sm:pl-5">
              <p className="text-xs text-muted-foreground">{t('harness.writeTargets')}</p>
              <p className="mt-3 truncate font-mono text-sm">
                {harness.targets[0]?.path ?? t('harness.noTargetFile')}
              </p>
              {harness.targets.length > 1 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('harness.moreFiles', { count: harness.targets.length - 1 })}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex items-start gap-3 border-t pt-4 text-sm text-muted-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <p className="pt-1 leading-relaxed">{t('harness.overwriteWarning')}</p>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            {!switching ? <h3 className="text-sm font-semibold">{t(words.collection)}</h3> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('harness.profileCount', { count: visibleGroups.length })}
            </p>
          </div>
          {extraActions}
        </div>

        <div className="space-y-3">
          {official?.available ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-4 shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <CircleUserRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{t(official.titleCode)}</p>
                    {official.active ? (
                      <Badge variant="secondary">{t('harness.active')}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(official.hintCode)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant={official.active ? 'secondary' : 'outline'}
                  disabled={official.active}
                  onClick={() => setActivatingOfficial(true)}
                >
                  {official.active ? t('harness.officialActive') : t('harness.officialSwitch')}
                </Button>
                {linkedOfficialProfile ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('harness.edit', { name: linkedOfficialProfile.name })}
                    onClick={() => onEdit(linkedOfficialProfile)}
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {visibleGroups.length === 0 && !linkedOfficialProfile ? (
            <div className="rounded-xl border border-dashed bg-card/60 px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('harness.noProfiles')}</p>
              <Button className="mt-4" size="sm" onClick={onAdd}>
                <Plus />
                {t('harness.newProfile')}
              </Button>
            </div>
          ) : visibleGroups.length > 0 ? (
            visibleGroups.map((group) => {
              if (group.favoriteId) {
                return (
                  <CollectionProfileCard
                    key={group.id}
                    group={group}
                    harness={harness}
                    onActivate={setActivating}
                    onOpenTemplate={onOpenTemplate}
                  />
                );
              }
              const profile = group.selected;
              const active =
                harness.active?.official !== true && harness.active?.name === profile.name;
              return (
                <ProfileRow
                  key={profile.name}
                  profile={profile}
                  harness={harness}
                  active={active}
                  switching={switching}
                  onOpenTemplate={onOpenTemplate}
                  onEdit={onEdit}
                  onCopy={onCopy}
                  setActivating={setActivating}
                  setPendingName={setPendingName}
                />
              );
            })
          ) : null}
        </div>
      </section>
      {activating ? (
        <ActivateDialog
          harness={harness}
          profile={activating}
          open
          onOpenChange={(open) => !open && setActivating(null)}
        />
      ) : null}
      {activatingOfficial ? (
        <ActivateDialog
          harness={harness}
          official
          open
          onOpenChange={(open) => !open && setActivatingOfficial(false)}
        />
      ) : null}
      <AlertDialog
        open={pendingName !== null}
        onOpenChange={(open) => !open && setPendingName(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('harness.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('harness.deleteBody', {
                harness: harness.label,
                profile: pendingName ?? '',
                extra: isLastDshOfficial
                  ? t('harness.deleteDshOfficialExtra')
                  : harness.mode === 'additive'
                    ? t('harness.deleteAdditiveExtra')
                    : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingName) {
                  void deleteProfile(harness.id, pendingName);
                }
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
