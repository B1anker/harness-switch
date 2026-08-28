import type { HarnessId, HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import {
  ArrowRightLeft,
  ChevronDown,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  Server,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BackupPanel } from '@/components/backup-panel';
import { ConfigTransferDialog } from '@/components/config-transfer-dialog';
import { DoctorPanel } from '@/components/doctor-panel';
import { HarnessCard } from '@/components/harness-card';
import { HarnessIcon } from '@/components/harness-icon';
import { LanguageToggle } from '@/components/language-toggle';
import { NoticeToast } from '@/components/notice-toast';
import { OperationsPanel } from '@/components/operations-panel';
import { ProfileDialog } from '@/components/profile-dialog';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { UpdateButton } from '@/components/update-button';
import { DevModeBadge, VersionBadge } from '@/components/version-badge';
import { useI18n, useTranslation } from '@/lib/i18n';
import { catalogKey, lineText } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type Editing = {
  harnessId: HarnessId;
  profile: ProfilePublic | null;
};

export function DashboardPage() {
  const { locale } = useI18n();
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const envFile = useAppStore((state) => state.envFile);
  const backups = useAppStore((state) => state.backups);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState<HarnessId>('claude');
  const editingHarness = harnesses.find((item) => item.id === editing?.harnessId);
  const selectedHarness = harnesses.find((item) => item.id === selectedHarnessId) ?? harnesses[0];

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur-xl">
        <div className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgb(99_91_255/0.8)]">
              <SlidersHorizontal className="size-5" />
            </span>
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
      <div className="grid xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        <HarnessTabs
          harnesses={harnesses}
          value={selectedHarness?.id}
          onChange={setSelectedHarnessId}
        />
        {selectedHarness ? (
          <main
            role="tabpanel"
            id={`harness-panel-${selectedHarness.id}`}
            aria-labelledby={`harness-tab-${selectedHarness.id}`}
            className="min-w-0 space-y-6 p-4 sm:p-6 xl:p-8"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{selectedHarness.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('harness.subtitle')}</p>
              </div>
              <Button
                className="self-start sm:self-auto"
                onClick={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
              >
                <Plus />
                {selectedHarness.id === 'dsh'
                  ? t('harness.addCustomProvider')
                  : t('harness.newProfile')}
              </Button>
            </div>
            <HarnessCard
              harness={selectedHarness}
              onAdd={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
              onEdit={(profile) => setEditing({ harnessId: selectedHarness.id, profile })}
            />
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
          </main>
        ) : null}
        {selectedHarness ? (
          <ContextPanel
            harness={selectedHarness}
            latestBackup={backups.find((backup) => backup.harness === selectedHarness.id)}
            locale={locale}
          />
        ) : null}
      </div>
      {editing && editingHarness ? (
        <ProfileDialog
          key={`${editing.harnessId}-${editing.profile?.name ?? 'new'}`}
          harness={editingHarness}
          profile={editing.profile}
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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  async function selectUser(username: string) {
    try {
      await switchUser(username);
      setOpen(false);
    } catch {
      // The store owns the translated error state; leave the menu open for a retry.
    }
  }

  async function signOut() {
    try {
      await logout();
      setOpen(false);
    } catch {
      // Keep the session menu available if the server could not end the session.
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-label={t('nav.currentLocalUser')}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={usersLoading}
        onClick={() => setOpen((value) => !value)}
      >
        <UserRound />
        <span className="max-w-28 truncate">{currentUser || t('nav.localUser')}</span>
        <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={t('nav.currentLocalUser')}
          className="absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground">{t('nav.currentLocalUser')}</div>
          {users.map((user) => {
            // An account this process cannot write to is shown but not offered: the
            // server refuses the switch anyway, so the reason belongs next to the name
            // rather than in an error after a click that was never going to work.
            const blocked = user.manageable === false;
            // Kept short and path-free: the menu is only as wide as a username, so an
            // interpolated path would wrap to three lines. The server's own prose still
            // carries the directory and rides along in the tooltip.
            const reason = blocked
              ? lineText(t, {
                  key: user.blockCode ? catalogKey(user.blockCode) : 'error.user.notSwitchable',
                  params: user.blockParams,
                  fallback: user.blockReason,
                })
              : '';
            const unselectable = usersLoading || user.username === currentUser || blocked;
            return (
              <button
                key={user.username}
                type="button"
                role="menuitemradio"
                aria-checked={user.username === currentUser}
                disabled={unselectable}
                title={blocked ? (user.blockReason ?? reason) : undefined}
                onClick={() => void selectUser(user.username)}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
                  // A row that cannot be picked must not light up under the cursor, or it
                  // reads as clickable right up until the click does nothing.
                  unselectable
                    ? 'cursor-default opacity-60'
                    : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                )}
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
              </button>
            );
          })}
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            disabled={usersLoading}
            onClick={() => void signOut()}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
              usersLoading ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-destructive/10',
            )}
          >
            <LogOut className="size-4" />
            {t('nav.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HarnessTabs({
  harnesses,
  value,
  onChange,
}: {
  harnesses: HarnessSummary[];
  value: HarnessId | undefined;
  onChange: (id: HarnessId) => void;
}) {
  const { t } = useTranslation();

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (!backward && !forward && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = harnesses.length - 1;
    } else {
      const offset = forward ? 1 : -1;
      nextIndex = (index + offset + harnesses.length) % harnesses.length;
    }
    const next = harnesses[nextIndex];
    if (next) {
      onChange(next.id);
      const tabs =
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs?.[nextIndex]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t('nav.switchHarness')}
      aria-orientation="vertical"
      className="flex gap-2 overflow-x-auto border-b bg-card/45 p-3 xl:min-h-[calc(100dvh-80px)] xl:flex-col xl:overflow-x-visible xl:border-b-0 xl:border-r xl:p-4"
    >
      {harnesses.map((harness, index) => {
        const selected = harness.id === value;
        const activeLabel = harness.active?.official
          ? t('harness.official')
          : (harness.active?.name ?? null);
        return (
          <button
            key={harness.id}
            type="button"
            role="tab"
            id={`harness-tab-${harness.id}`}
            aria-controls={`harness-panel-${harness.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(harness.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'flex min-w-[12rem] shrink-0 cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-[color,background-color,box-shadow,transform] duration-150 active:translate-y-px xl:min-w-0 xl:w-full',
              selected
                ? 'bg-primary/[0.09] text-primary shadow-[inset_0_0_0_1px_rgb(99_91_255/0.13)]'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card shadow-[0_4px_12px_-8px_rgb(36_39_70/0.28)]',
                selected ? 'border-primary/20' : 'border-border',
              )}
            >
              <HarnessIcon id={harness.id} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-current">
                {harness.label}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {activeLabel === null
                  ? t('harness.currentInactive')
                  : t('harness.current', { name: activeLabel })}
              </span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {harness.profiles.length}
            </span>
          </button>
        );
      })}
    </div>
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
                <p className="text-xs text-muted-foreground">{target.label}</p>
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
