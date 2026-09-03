import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { CircleUserRound, Copy, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ActivateDialog } from '@/components/activate-dialog';
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
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type HarnessCardProps = {
  harness: HarnessSummary;
  onAdd: () => void;
  onEdit: (profile: ProfilePublic) => void;
  onCopy?: (profile: ProfilePublic) => void;
  extraActions?: ReactNode;
};

export function HarnessCard({ harness, onAdd, onEdit, onCopy, extraActions }: HarnessCardProps) {
  const { t } = useTranslation();
  const deleteProfile = useAppStore((state) => state.deleteProfile);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [activating, setActivating] = useState<ProfilePublic | null>(null);
  const [activatingOfficial, setActivatingOfficial] = useState(false);
  // A saved DSH official API profile already represents the same native
  // `llm-deepseek` entry the detector finds. Show one editable card, not both.
  const dshOfficialProfile =
    harness.id === 'dsh'
      ? harness.profiles.find((profile) => profile.extras.providerType === 'official')
      : undefined;
  const dshOfficialCount = harness.profiles.filter(
    (profile) => profile.extras.providerType === 'official',
  ).length;
  const visibleProfiles = harness.profiles.filter(
    (profile) =>
      !(
        harness.id === 'dsh' &&
        harness.officialAvailable === true &&
        profile.extras.providerType === 'official'
      ),
  );
  const dshOfficialActive =
    dshOfficialProfile !== undefined &&
    harness.active?.official !== true &&
    harness.active?.name === dshOfficialProfile.name;

  // The stored name of the official entry is data on disk, so the display text
  // comes from the `official` flag rather than from matching the name.
  const activeName = harness.active?.official
    ? t('harness.official')
    : (harness.active?.name ?? null);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/10">
        <CardContent className="p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)] sm:divide-x">
            <div className="min-w-0 sm:pr-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-primary shadow-[0_0_0_4px_rgb(99_91_255/0.1)]" />
                {harness.id === 'dsh' ? t('harness.defaultModel') : t('harness.activeConfig')}
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
            <h3 className="text-sm font-semibold">
              {harness.id === 'dsh' ? t('harness.providers') : t('harness.profiles')}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('harness.profileCount', { count: visibleProfiles.length })}
            </p>
          </div>
          {extraActions}
        </div>

        <div className="space-y-3">
          {harness.supportsOfficialAuth && harness.officialAvailable !== false ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-4 shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <CircleUserRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {harness.id === 'dsh' ? t('harness.deepseekOfficial') : t('harness.official')}
                    </p>
                    {harness.active?.official || dshOfficialActive ? (
                      <Badge variant="secondary">{t('harness.active')}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {harness.id === 'claude'
                      ? t('harness.officialHintClaude')
                      : harness.id === 'kimi'
                        ? t('harness.officialHintKimi')
                        : harness.id === 'dsh'
                          ? t('harness.officialHintDsh')
                          : t('harness.officialHintCodex')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant={harness.active?.official || dshOfficialActive ? 'secondary' : 'outline'}
                  disabled={harness.active?.official || dshOfficialActive}
                  onClick={() => {
                    if (dshOfficialProfile) setActivating(dshOfficialProfile);
                    else setActivatingOfficial(true);
                  }}
                >
                  {harness.active?.official || dshOfficialActive
                    ? t('harness.officialActive')
                    : t('harness.officialSwitch')}
                </Button>
                {dshOfficialProfile ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('harness.edit', { name: dshOfficialProfile.name })}
                    onClick={() => onEdit(dshOfficialProfile)}
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {visibleProfiles.length === 0 && !dshOfficialProfile ? (
            <div className="rounded-xl border border-dashed bg-card/60 px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('harness.noProfiles')}</p>
              <Button className="mt-4" size="sm" onClick={onAdd}>
                <Plus />
                {t('harness.newProfile')}
              </Button>
            </div>
          ) : visibleProfiles.length > 0 ? (
            visibleProfiles.map((profile) => {
              const active =
                harness.active?.official !== true && harness.active?.name === profile.name;
              const dshOfficial =
                harness.id === 'dsh' && profile.extras.providerType === 'official';
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
                        <p className="font-medium">
                          {dshOfficial ? t('harness.deepseekOfficial') : profile.name}
                        </p>
                        {active ? (
                          <Badge>
                            {harness.id === 'dsh' ? t('harness.default') : t('harness.active')}
                          </Badge>
                        ) : null}
                        {dshOfficial ? (
                          <Badge variant="secondary">{t('harness.official')}</Badge>
                        ) : null}
                        {profile.overriddenTargets.length > 0 ? (
                          <Badge variant="outline">{t('harness.manualOverride')}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {profile.baseUrl}
                      </p>
                      {profile.model ? (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {profile.model}
                        </p>
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
                      {active
                        ? harness.id === 'dsh'
                          ? t('harness.default')
                          : t('harness.active')
                        : harness.id === 'dsh'
                          ? t('harness.setDefault')
                          : t('harness.activate')}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('harness.edit', { name: profile.name })}
                      onClick={() => onEdit(profile)}
                    >
                      <Pencil />
                    </Button>
                    {!dshOfficial ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('harness.copy', { name: profile.name })}
                        onClick={() => onCopy?.(profile)}
                      >
                        <Copy />
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('harness.delete', { name: profile.name })}
                      disabled={active || (dshOfficial && dshOfficialCount === 1)}
                      title={active ? t('harness.deleteBlocked') : undefined}
                      onClick={() => setPendingName(profile.name)}
                    >
                      <Trash2
                        className={
                          active || (dshOfficial && dshOfficialCount === 1)
                            ? undefined
                            : 'text-destructive'
                        }
                      />
                    </Button>
                  </div>
                </div>
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
                extra: harness.mode === 'additive' ? t('harness.deleteAdditiveExtra') : '',
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
