import type { HarnessId, HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { catalogKey } from '@seaveyon/harness-switch-shared';
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  History,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Server,
  Star,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { BackupPanel } from '@/components/backup-panel';
import { BrandMark } from '@/components/brand-mark';
import { ConfigTransferDialog } from '@/components/config-transfer-dialog';
import { DoctorPanel } from '@/components/doctor-panel';
import { HarnessCard } from '@/components/harness-card';
import { HarnessTabs } from '@/components/harness-tabs';
import { LanguageToggle } from '@/components/language-toggle';
import { ModelFavorites } from '@/components/model-favorites';
import { NoticeToast } from '@/components/notice-toast';
import { OperationsPanel } from '@/components/operations-panel';
import { ProfileDialog } from '@/components/profile-dialog';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { RecoveryTimeline } from '@/components/recovery-timeline';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { UpdateButton } from '@/components/update-button';
import { DevModeBadge, VersionBadge } from '@/components/version-badge';
import { Workspace } from '@/components/workspace';
import { ConfigurationSwitcher } from '@/components/workspace/configuration-switcher';
import { useI18n, useTranslation } from '@/lib/i18n';
import { lineText, specText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type Editing = {
  harnessId: HarnessId;
  profile: ProfilePublic | null;
  copySource?: ProfilePublic;
};

export function DashboardPage() {
  const currentUser = useAppStore((state) => state.currentUser);
  const [view, setView] = useState<'workspace' | 'favorites' | 'history' | 'tools'>('workspace');
  const { locale } = useI18n();
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const envFile = useAppStore((state) => state.envFile);
  const backups = useAppStore((state) => state.backups);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState<HarnessId>('claude');
  const [templateToOpen, setTemplateToOpen] = useState('');
  const editingHarness = harnesses.find((item) => item.id === editing?.harnessId);
  const selectedHarness = harnesses.find((item) => item.id === selectedHarnessId) ?? harnesses[0];

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur-xl">
        <div className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="size-10 shrink-0 ring-1 ring-black/5 dark:ring-white/10" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
                  harness-switch
                </h1>
                <VersionBadge />
                <DevModeBadge />
                <UpdateButton />
              </div>
              <p className="truncate text-xs text-muted-foreground">{t('app.tagline')}</p>
            </div>
          </div>
          <TabList
            label={t('workspace.navigation')}
            idPrefix="dashboard"
            items={[
              { id: 'workspace' as const, icon: LayoutGrid },
              { id: 'favorites' as const, icon: Star },
              { id: 'history' as const, icon: History },
            ]}
            value={view === 'tools' ? 'workspace' : view}
            onChange={setView}
            className="order-3 flex w-full gap-2 overflow-x-auto border-t pt-2 lg:order-none lg:w-auto lg:border-0 lg:pt-0"
            tabClassName="gap-2 px-4 py-3 text-sm font-medium"
          >
            {(item) => (
              <>
                <item.icon className="size-4" />
                {t('workspace.nav.' + item.id)}
              </>
            )}
          </TabList>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
              <ArrowRightLeft />
              <span className="hidden sm:inline">{t('nav.transfer')}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setVaultOpen(true)}>
              <KeyRound />
              <span className="hidden sm:inline">{t('nav.vault')}</span>
            </Button>
            <LanguageToggle />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <TabPanel idPrefix="dashboard" value={view === 'tools' ? 'workspace' : view}>
        {view === 'workspace' ? (
          <Workspace
            key={currentUser}
            selectedHarnessId={selectedHarnessId}
            onSelectHarness={setSelectedHarnessId}
            onConfigure={(id) => {
              setSelectedHarnessId(id);
              setView('tools');
            }}
            onHistory={() => setView('history')}
          />
        ) : view === 'favorites' ? (
          <ModelFavorites
            key={`${currentUser}/${templateToOpen}`}
            initialSelectedId={templateToOpen}
          />
        ) : view === 'history' ? (
          <RecoveryTimeline key={currentUser} />
        ) : (
          <div className="grid xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
            <HarnessTabs
              harnesses={harnesses}
              value={selectedHarness?.id}
              onChange={setSelectedHarnessId}
            />
            {selectedHarness ? (
              <TabPanel
                as="main"
                idPrefix="harness"
                value={selectedHarness.id}
                className="min-w-0 space-y-6 p-4 sm:p-6 xl:p-8"
              >
                <nav
                  aria-label={t('workspace.breadcrumb')}
                  className="flex items-center gap-1 text-sm text-muted-foreground"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setView('workspace')}
                  >
                    <ArrowLeft />
                    {t('workspace.back')}
                  </Button>
                  <ChevronRight className="size-4" aria-hidden />
                  <span className="font-medium text-foreground">{selectedHarness.label}</span>
                </nav>
                <ConfigurationSwitcher
                  harness={selectedHarness}
                  onNewProfile={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
                  onOpenTemplate={(id) => {
                    setTemplateToOpen(id);
                    setView('favorites');
                  }}
                />
                <details className="group rounded-2xl border bg-card px-5 py-4 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.35)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                    <span>{t('workspace.manageConfigurations')}</span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-6">
                    <HarnessCard
                      harness={selectedHarness}
                      onAdd={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
                      onEdit={(profile) => setEditing({ harnessId: selectedHarness.id, profile })}
                      onCopy={(copySource) =>
                        setEditing({ harnessId: selectedHarness.id, profile: null, copySource })
                      }
                    />
                  </div>
                </details>
                <details className="group rounded-2xl border bg-card px-5 py-4 text-sm shadow-[0_12px_34px_-28px_rgb(36_39_70/0.35)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                    <span className="font-mono text-[13px]">{t('env.title')}</span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-4 leading-relaxed text-muted-foreground">{t('env.intro')}</p>
                  <code className="mt-3 block rounded-xl bg-muted/70 px-4 py-3 font-mono text-[13px]">
                    source {envFile || '~/.harness-switch/env.sh'}
                  </code>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{t('env.note')}</p>
                </details>
              </TabPanel>
            ) : null}
            {selectedHarness ? (
              <ContextPanel
                harness={selectedHarness}
                latestBackup={backups.find((backup) => backup.harness === selectedHarness.id)}
                locale={locale}
              />
            ) : null}
          </div>
        )}
      </TabPanel>
      {editing && editingHarness ? (
        <ProfileDialog
          key={`${editing.harnessId}-${editing.profile?.name ?? editing.copySource?.name ?? 'new'}`}
          harness={editingHarness}
          profile={editing.profile}
          copySource={editing.copySource}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      <ConfigTransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
      <ProviderVaultDialog open={vaultOpen} onOpenChange={setVaultOpen} />
      <NoticeToast />
    </div>
  );
}

/** Keeps identity-changing actions together instead of splitting them across the header. */
function UserMenu() {
  const { t } = useTranslation();
  const logout = useAppStore((state) => state.logout);
  const users = useAppStore((state) => state.users);
  const currentUser = useAppStore((state) => state.currentUser);
  const usersLoading = useAppStore((state) => state.usersLoading);
  const switchUser = useAppStore((state) => state.switchUser);

  return (
    <DropdownMenu
      label={t('nav.currentLocalUser')}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="group"
          aria-label={t('nav.currentLocalUser')}
          disabled={usersLoading}
        >
          <UserRound />
          <span className="max-w-28 truncate">{currentUser || t('nav.localUser')}</span>
          <ChevronDown className="transition-transform group-aria-expanded:rotate-180" />
        </Button>
      }
    >
      {(close) => (
        <>
          <DropdownMenuLabel>{t('nav.currentLocalUser')}</DropdownMenuLabel>
          {users.map((user) => {
            // An account this process cannot write to is shown but not offered: the
            // server refuses the switch anyway, so the reason belongs next to the name
            // rather than in an error after a click that was never going to work.
            const blocked = user.manageable === false;
            // Kept short and path-free: the menu is only as wide as a username, so an
            // interpolated path would wrap to three lines. The directory travels as data
            // and is appended in the tooltip instead.
            const reason = blocked
              ? lineText(t, {
                  key: user.blockCode ? catalogKey(user.blockCode) : 'error.user.notSwitchable',
                  params: user.blockData,
                })
              : '';
            const blockedPath = user.blockData?.path ?? user.blockData?.home;
            return (
              <DropdownMenuItem
                key={user.username}
                role="menuitemradio"
                aria-checked={user.username === currentUser}
                disabled={usersLoading || user.username === currentUser || blocked}
                title={blocked ? [reason, blockedPath].filter(Boolean).join(' — ') : undefined}
                className="flex-col items-start"
                onClick={() => {
                  // The store owns the translated error state; a failure leaves the menu
                  // open for a retry.
                  void switchUser(user.username).then(close, () => {});
                }}
              >
                <span className="flex w-full items-center gap-1.5">
                  {blocked ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
                  <span className="truncate">{user.username}</span>
                </span>
                {blocked ? (
                  <span className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {reason}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            role="menuitem"
            destructive
            disabled={usersLoading}
            className="gap-2"
            // Keep the session menu available if the server could not end the session.
            onClick={() => void logout().then(close, () => {})}
          >
            <LogOut className="size-4" />
            {t('nav.signOut')}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenu>
  );
}

function ContextPanel({
  harness,
  latestBackup,
  locale,
}: {
  harness: HarnessSummary;
  locale: string;
  latestBackup:
    | {
        profile: string;
        createdAt: string;
        files: { path: string }[];
      }
    | undefined;
}) {
  const { t } = useTranslation();
  return (
    <aside className="border-t bg-card/35 p-4 sm:p-6 xl:min-h-[calc(100dvh-80px)] xl:border-l xl:border-t-0 xl:p-5">
      <div className="space-y-4 xl:sticky xl:top-[100px]">
        <section className="rounded-2xl border bg-card p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-primary" />
            <h3 className="font-semibold">{t('harness.writeTargets')}</h3>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">{t('harness.application')}</p>
              <p className="mt-1 text-sm font-medium">{harness.label}</p>
            </div>
            {harness.targets.map((target) => (
              <div key={target.key}>
                <p className="text-xs text-muted-foreground">
                  {specText(t, target.labelCode, target.label)}
                </p>
                <p className="mt-1 break-all font-mono text-xs leading-relaxed">{target.path}</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-muted-foreground">{t('harness.writeMode')}</p>
              <p className="mt-1 text-sm">
                {harness.mode === 'replace' ? t('harness.modeReplace') : t('harness.modeAdditive')}
              </p>
            </div>
          </div>
        </section>

        <DoctorPanel harness={harness} />

        <OperationsPanel harness={harness} />

        <section className="rounded-2xl border bg-card p-5 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.38)]">
          <h3 className="font-semibold">{t('backup.latest')}</h3>
          {latestBackup ? (
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('backup.profile')}</p>
                <p className="mt-1 truncate text-sm font-medium">{latestBackup.profile}</p>
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {new Date(latestBackup.createdAt).toLocaleString(locale)} ·{' '}
                {t('backup.fileCount', { count: latestBackup.files.length })}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t('backup.empty')}</p>
          )}
          <div className="mt-4 border-t pt-4">
            <BackupPanel harnessId={harness.id} />
          </div>
        </section>
      </div>
    </aside>
  );
}
