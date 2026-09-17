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
  UserRound,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BackupPanel } from '@/components/backup-panel';
import { BrandMark } from '@/components/brand-mark';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { ConfigTransferDialog } from '@/components/config-transfer-dialog';
import { DoctorRow, HealthBanner } from '@/components/doctor-panel';
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
import { Disclosure } from '@/components/ui/disclosure';
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

/**
 * Where templates open to: a selected template, optionally straight into its editor, or
 * the create dialog when the tool page suggested making one.
 */
type TemplateEntry = { id: string; create: boolean; edit?: boolean };

export function DashboardPage() {
  const currentUser = useAppStore((state) => state.currentUser);
  // `favorites` and `tools` are sub-views of the workspace; the top rail knows only two.
  const [view, setView] = useState<'workspace' | 'favorites' | 'history' | 'tools'>('workspace');
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState<HarnessId>('claude');
  const [templateEntry, setTemplateEntry] = useState<TemplateEntry>({ id: '', create: false });
  const editingHarness = harnesses.find((item) => item.id === editing?.harnessId);
  const selectedHarness = harnesses.find((item) => item.id === selectedHarnessId) ?? harnesses[0];
  const mainTab = view === 'history' ? 'history' : 'workspace';

  function openTemplates(entry: TemplateEntry) {
    setTemplateEntry(entry);
    setView('favorites');
  }

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
              { id: 'history' as const, icon: History },
            ]}
            value={mainTab}
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
      <TabPanel idPrefix="dashboard" value={mainTab}>
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
          <>
            <Breadcrumb
              backLabel={
                selectedHarness
                  ? t('workspace.backToTool', { name: selectedHarness.label })
                  : t('workspace.back')
              }
              onBack={() => setView(selectedHarness ? 'tools' : 'workspace')}
            >
              {t('workspace.nav.favorites')}
            </Breadcrumb>
            <ModelFavorites
              key={`${currentUser}/${templateEntry.id}/${templateEntry.create}/${templateEntry.edit}`}
              initialSelectedId={templateEntry.id}
              startCreating={templateEntry.create}
              startEditing={!!templateEntry.edit && !!templateEntry.id}
            />
          </>
        ) : view === 'history' ? (
          <RecoveryTimeline key={currentUser} />
        ) : (
          <div className="grid xl:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="xl:row-span-2">
              <HarnessTabs
                harnesses={harnesses}
                value={selectedHarness?.id}
                onChange={setSelectedHarnessId}
              />
            </div>
            {selectedHarness ? (
              <Breadcrumb backLabel={t('workspace.back')} onBack={() => setView('workspace')}>
                {selectedHarness.label}
              </Breadcrumb>
            ) : null}
            {selectedHarness ? (
              <TabPanel
                as="main"
                idPrefix="harness"
                value={selectedHarness.id}
                className="min-w-0 space-y-6 p-4 sm:p-6 xl:p-8"
              >
                <HealthBanner harness={selectedHarness} />
                <ConfigurationSwitcher
                  harness={selectedHarness}
                  onNewProfile={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
                  onEditProfile={(profile) =>
                    setEditing({ harnessId: selectedHarness.id, profile })
                  }
                  onCopyProfile={(copySource) =>
                    setEditing({ harnessId: selectedHarness.id, profile: null, copySource })
                  }
                  onOpenTemplate={(id) => openTemplates({ id, create: false, edit: true })}
                  onManageTemplates={() => openTemplates({ id: '', create: false })}
                  onCreateTemplate={() => openTemplates({ id: '', create: true })}
                />
                <ToolDetails harness={selectedHarness} />
              </TabPanel>
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
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <>
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
              disabled={usersLoading}
              className="gap-2"
              onClick={() => {
                close();
                setPasswordOpen(true);
              }}
            >
              <KeyRound className="size-4" />
              {t('account.password.title')}
            </DropdownMenuItem>
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
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

/** The one-level path back from a sub-view: `← back › where you are`. */
function Breadcrumb({
  backLabel,
  onBack,
  children,
}: {
  backLabel: string;
  onBack(): void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('workspace.breadcrumb')}
      className="flex min-w-0 items-center gap-1 border-b bg-card/30 px-4 py-3 text-sm text-muted-foreground sm:px-6"
    >
      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onBack}>
        <ArrowLeft />
        {backLabel}
      </Button>
      <ChevronRight className="size-4 shrink-0" aria-hidden />
      <span className="truncate font-medium text-foreground">{children}</span>
    </nav>
  );
}

/**
 * Everything about a tool that is not "which configuration is it using": where writes
 * land and how, the env file, the doctor report, and — once there has been a write —
 * the receipts and backups it left behind. Folded by default so the first screen holds
 * only the configuration list; a user who needs a path or a backup opens it.
 */
function ToolDetails({ harness }: { harness: HarnessSummary }) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const envFile = useAppStore((state) => state.envFile);
  const backups = useAppStore((state) => state.backups);
  const latestBackup = backups.find((backup) => backup.harness === harness.id);
  return (
    <section className="rounded-2xl border bg-card px-5 py-3 shadow-[0_12px_34px_-28px_rgb(36_39_70/0.35)]">
      <Disclosure
        title={t('workspace.details')}
        summary={t('workspace.detailsSummary')}
        triggerClassName="-mx-3 w-[calc(100%+1.5rem)] justify-start"
      >
        <div className="grid gap-6 pt-1 text-sm sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-2">
              <Server className="size-4 text-primary" />
              <h4 className="text-sm font-semibold">{t('harness.writeTargets')}</h4>
            </div>
            <div className="mt-3 space-y-3">
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
                  {harness.mode === 'replace'
                    ? t('harness.modeReplace')
                    : t('harness.modeAdditive')}
                </p>
              </div>
            </div>
          </div>
          <div>
            <h4 className="font-mono text-[13px] font-semibold">{t('env.title')}</h4>
            <p className="mt-3 leading-relaxed text-muted-foreground">{t('env.intro')}</p>
            <code className="mt-3 block rounded-xl bg-muted/70 px-4 py-3 font-mono text-[13px]">
              source {envFile || '~/.harness-switch/env.sh'}
            </code>
            <p className="mt-3 leading-relaxed text-muted-foreground">{t('env.note')}</p>
          </div>
        </div>
        <div className="space-y-5 border-t pt-4 pb-2">
          <DoctorRow harness={harness} />
          <OperationsPanel harness={harness} />
          {latestBackup ? (
            <div>
              <div className="flex items-center gap-2">
                <History className="size-4 text-primary" />
                <h4 className="text-sm font-semibold">{t('backup.latest')}</h4>
              </div>
              <p className="mt-2 truncate text-sm">
                <span className="font-medium">{latestBackup.profile}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {new Date(latestBackup.createdAt).toLocaleString(locale)}
                  {' · '}
                  {t('backup.fileCount', { count: latestBackup.files.length })}
                </span>
              </p>
              <div className="mt-3">
                <BackupPanel harnessId={harness.id} />
              </div>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </section>
  );
}
