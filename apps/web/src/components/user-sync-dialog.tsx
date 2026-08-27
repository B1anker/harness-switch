import type { HarnessId, UserSyncPreview, UserSyncResponse } from '@seaveyon/harness-switch-shared';
import { HARNESS_IDS, HARNESS_LABELS } from '@seaveyon/harness-switch-shared';
import { Copy, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine, messageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function UserSyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const users = useAppStore((state) => state.users);
  const currentUser = useAppStore((state) => state.currentUser);
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const setNotice = useAppStore((state) => state.setNotice);
  const sources = useMemo(
    // Reading a source user's config needs the same access as managing it, so an
    // unmanageable account cannot be a sync source either.
    () => users.filter((user) => user.username !== currentUser && user.manageable !== false),
    [users, currentUser],
  );
  const [sourceUser, setSourceUser] = useState('');
  const [preview, setPreview] = useState<UserSyncPreview | null>(null);
  const [overwriteHarnesses, setOverwriteHarnesses] = useState<HarnessId[]>([]);
  const [migrateCodexLoginCache, setMigrateCodexLoginCache] = useState(false);
  const [confirmingCacheMigration, setConfirmingCacheMigration] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);
  const conflictHarnesses = useMemo(
    () =>
      HARNESS_IDS.flatMap((harness) => {
        const count =
          preview?.conflicts.filter((conflict) => conflict.harness === harness).length ?? 0;
        return count > 0 ? [{ harness, count }] : [];
      }),
    [preview],
  );
  const targetLabel = currentUser || t('notice.currentUser');

  useEffect(() => {
    if (!open) return;
    setSourceUser((current) =>
      sources.some((user) => user.username === current) ? current : (sources[0]?.username ?? ''),
    );
    setPreview(null);
    setOverwriteHarnesses([]);
    setMigrateCodexLoginCache(false);
    setConfirmingCacheMigration(false);
    setError(null);
  }, [open, sources]);

  async function inspect() {
    if (!sourceUser) return;
    setPending(true);
    setError(null);
    try {
      const inspected = await api<UserSyncPreview>('/api/users/sync/preview', {
        method: 'POST',
        body: JSON.stringify({ sourceUser }),
      });
      setPreview(inspected);
      setOverwriteHarnesses([]);
      setMigrateCodexLoginCache(false);
      setConfirmingCacheMigration(false);
    } catch (err) {
      setPreview(null);
      setOverwriteHarnesses([]);
      setError(errorLine(err));
    } finally {
      setPending(false);
    }
  }

  async function synchronize() {
    if (!sourceUser || !preview) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<UserSyncResponse>('/api/users/sync', {
        method: 'POST',
        body: JSON.stringify({
          sourceUser,
          conflictPolicy: 'skip',
          overwriteHarnesses,
          migrateCodexLoginCache,
        }),
      });
      await Promise.all([loadHarnesses(), loadProviders()]);
      const notice: MessageLine[] = [
        {
          key: 'sync.done',
          params: {
            imported: result.imported,
            overwritten: result.overwritten,
            skipped: result.skipped,
            providersCopied: result.providersCopied,
          },
        },
        {
          key: result.codexLoginCacheMigrated ? 'sync.cacheMigrated' : 'sync.cacheNotMigrated',
        },
        ...result.warnings.map((warning) => messageLine(warning)),
      ];
      setNotice(notice);
      onOpenChange(false);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:w-full">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{t('sync.title')}</DialogTitle>
          <DialogDescription>{t('sync.intro', { user: targetLabel })}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {sources.length > 0 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="sync-source-user">{t('sync.sourceUser')}</Label>
                <Select
                  value={sourceUser}
                  onValueChange={(value) => {
                    setSourceUser(value);
                    setPreview(null);
                    setOverwriteHarnesses([]);
                    setMigrateCodexLoginCache(false);
                  }}
                >
                  <SelectTrigger id="sync-source-user">
                    <SelectValue placeholder={t('sync.selectUser')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((user) => (
                      <SelectItem key={user.username} value={user.username}>
                        {user.username} · {user.homeDir}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preview ? (
                <div className="space-y-4 rounded-2xl border bg-muted/25 p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {t('sync.profileCount', { count: preview.profileCount })}
                    </Badge>
                    <Badge variant="secondary">
                      {t('sync.providerCount', { count: preview.providerCount })}
                    </Badge>
                    <Badge variant={preview.conflicts.length > 0 ? 'destructive' : 'outline'}>
                      {t('sync.conflictCount', { count: preview.conflicts.length })}
                    </Badge>
                  </div>
                  {preview.conflicts.length > 0 ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label>{t('sync.overwriteByHarness')}</Label>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t('sync.overwriteHint')}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {conflictHarnesses.map(({ harness, count }) => (
                          <label
                            key={harness}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background/70 p-3 text-sm"
                          >
                            <Checkbox
                              checked={overwriteHarnesses.includes(harness)}
                              onCheckedChange={(checked) =>
                                setOverwriteHarnesses((current) =>
                                  checked === true
                                    ? [...current, harness]
                                    : current.filter((item) => item !== harness),
                                )
                              }
                              className="mt-0.5"
                            />
                            <span>
                              <span className="block font-medium">
                                {t('sync.overwriteHarness', { harness: HARNESS_LABELS[harness] })}
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {t('sync.conflictsInHarness', { count })}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {preview.codexLoginCache.available && preview.codexLoginCache.migrationNeeded ? (
                    <label className="block space-y-3 rounded-xl border bg-background/70 p-3 text-sm">
                      <span className="flex cursor-pointer items-start gap-3">
                        <Checkbox
                          checked={migrateCodexLoginCache}
                          onCheckedChange={(checked) => setMigrateCodexLoginCache(checked === true)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">{t('sync.migrateCache')}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {t('sync.migrateCacheHint')}
                          </span>
                        </span>
                      </span>
                      {preview.codexLoginCache.targetExists ? (
                        <span className="block rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                          {t('sync.migrateCacheOverwrite')}
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('sync.storeOnlyHint')}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border bg-muted/25 p-4">
              <Users className="mt-0.5 size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('sync.noOtherUsers')}</p>
            </div>
          )}

          {error ? <p className="mt-4 text-sm text-destructive">{lineText(t, error)}</p> : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-card px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {!preview ? (
            <Button
              className="w-full sm:w-auto"
              disabled={!sourceUser || pending}
              onClick={() => void inspect()}
            >
              <Copy />
              {pending ? t('sync.inspecting') : t('sync.inspect')}
            </Button>
          ) : migrateCodexLoginCache ? (
            <AlertDialog open={confirmingCacheMigration} onOpenChange={setConfirmingCacheMigration}>
              <Button
                className="w-full sm:w-auto"
                disabled={pending}
                onClick={() => setConfirmingCacheMigration(true)}
              >
                <Copy />
                {pending ? t('sync.syncing') : t('sync.syncTo', { user: targetLabel })}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sync.confirmCacheTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('sync.confirmCacheBody', {
                      source: sourceUser,
                      target: targetLabel,
                      extra: preview.codexLoginCache.targetExists
                        ? t('sync.confirmCacheOverwrite')
                        : t('sync.confirmCacheFresh'),
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void synchronize()}>
                    {t('sync.confirmCacheAction')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => void synchronize()}
            >
              <Copy />
              {pending ? t('sync.syncing') : t('sync.syncTo', { user: targetLabel })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
