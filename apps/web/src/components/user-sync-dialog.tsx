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
import { useAppStore } from '@/stores/app-store';

export function UserSyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const users = useAppStore((state) => state.users);
  const currentUser = useAppStore((state) => state.currentUser);
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const setNotice = useAppStore((state) => state.setNotice);
  const sources = useMemo(
    () => users.filter((user) => user.username !== currentUser),
    [users, currentUser],
  );
  const [sourceUser, setSourceUser] = useState('');
  const [preview, setPreview] = useState<UserSyncPreview | null>(null);
  const [overwriteHarnesses, setOverwriteHarnesses] = useState<HarnessId[]>([]);
  const [migrateCodexLoginCache, setMigrateCodexLoginCache] = useState(false);
  const [confirmingCacheMigration, setConfirmingCacheMigration] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflictHarnesses = useMemo(
    () =>
      HARNESS_IDS.flatMap((harness) => {
        const count =
          preview?.conflicts.filter((conflict) => conflict.harness === harness).length ?? 0;
        return count > 0 ? [{ harness, count }] : [];
      }),
    [preview],
  );

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
      setError((err as Error).message);
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
      const warning = result.warnings.length > 0 ? ` 注意：${result.warnings.join('；')}` : '';
      const cacheResult = result.codexLoginCacheMigrated
        ? 'Codex 登录缓存已迁移。'
        : 'Codex 登录缓存未迁移。';
      // The result belongs in the toast, not in a dialog the user has to dismiss: leaving
      // this open reads as "there is more to do here" and invites a second sync.
      setNotice(
        `同步完成：新增 ${result.imported}，覆盖 ${result.overwritten}，跳过 ${result.skipped}，复制凭据 ${result.providersCopied}。${cacheResult}${warning}`,
      );
      onOpenChange(false);
    } catch (err) {
      // A failure stays inline, where the options that caused it are still on screen.
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:w-full">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>从其他用户同步</DialogTitle>
          <DialogDescription>
            将来源用户的配置和所引用的凭据复制到 {currentUser || '当前用户'}
            。激活状态、备份和原生配置文件默认不会复制；可单独选择迁移 Codex 登录缓存。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {sources.length > 0 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="sync-source-user">来源用户</Label>
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
                    <SelectValue placeholder="选择本地用户" />
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
                    <Badge variant="secondary">配置 {preview.profileCount}</Badge>
                    <Badge variant="secondary">凭据 {preview.providerCount}</Badge>
                    <Badge variant={preview.conflicts.length > 0 ? 'destructive' : 'outline'}>
                      同名冲突 {preview.conflicts.length}
                    </Badge>
                  </div>
                  {preview.conflicts.length > 0 ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label>按 Harness 覆盖同名配置</Label>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          只覆盖勾选的 Harness；未勾选的同名配置会保留当前用户版本。
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
                                覆盖 {HARNESS_LABELS[harness]}
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {count} 个同名配置
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
                          <span className="block font-medium">
                            迁移 Codex 官方登录缓存（auth.json）
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            这会复制可复用的 Codex
                            登录会话，不是普通配置。仅在目标用户可以使用该登录时选择。
                          </span>
                        </span>
                      </span>
                      {preview.codexLoginCache.targetExists ? (
                        <span className="block rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                          目标用户已有登录缓存；继续后将覆盖它，并自动创建备份。
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    同步仅写入配置库。需要生效时，请在同步后手动激活对应配置。
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border bg-muted/25 p-4">
              <Users className="mt-0.5 size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">没有其他可管理的本地登录用户。</p>
            </div>
          )}

          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-card px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {!preview ? (
            <Button
              className="w-full sm:w-auto"
              disabled={!sourceUser || pending}
              onClick={() => void inspect()}
            >
              <Copy />
              {pending ? '正在检查…' : '检查可同步内容'}
            </Button>
          ) : migrateCodexLoginCache ? (
            <AlertDialog open={confirmingCacheMigration} onOpenChange={setConfirmingCacheMigration}>
              <Button
                className="w-full sm:w-auto"
                disabled={pending}
                onClick={() => setConfirmingCacheMigration(true)}
              >
                <Copy />
                {pending ? '正在同步…' : `同步到 ${currentUser}`}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认迁移 Codex 登录缓存？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将把 {sourceUser} 的 Codex 官方登录缓存（auth.json）复制到{' '}
                    {currentUser || '当前用户'}。
                    {preview.codexLoginCache.targetExists
                      ? '目标用户已有缓存，会被覆盖并创建备份。'
                      : '目标用户将获得新的本地登录缓存。'}
                    仅当目标用户可以使用这个登录会话时才继续。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void synchronize()}>
                    迁移登录缓存并同步
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
              {pending ? '正在同步…' : `同步到 ${currentUser}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
