import type {
  TransferConflictPolicy,
  UserSyncPreview,
  UserSyncResponse,
} from '@seaveyon/harness-switch-shared';
import { Copy, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  const sources = useMemo(
    () => users.filter((user) => user.username !== currentUser),
    [users, currentUser],
  );
  const [sourceUser, setSourceUser] = useState('');
  const [policy, setPolicy] = useState<TransferConflictPolicy>('skip');
  const [preview, setPreview] = useState<UserSyncPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSourceUser((current) =>
      sources.some((user) => user.username === current) ? current : (sources[0]?.username ?? ''),
    );
    setPreview(null);
    setMessage(null);
    setError(null);
  }, [open, sources]);

  async function inspect() {
    if (!sourceUser) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      setPreview(
        await api<UserSyncPreview>('/api/users/sync/preview', {
          method: 'POST',
          body: JSON.stringify({ sourceUser }),
        }),
      );
    } catch (err) {
      setPreview(null);
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
        body: JSON.stringify({ sourceUser, conflictPolicy: policy }),
      });
      await Promise.all([loadHarnesses(), loadProviders()]);
      const warning = result.warnings.length > 0 ? ` 注意：${result.warnings.join('；')}` : '';
      setMessage(
        `同步完成：新增 ${result.imported}，覆盖 ${result.overwritten}，跳过 ${result.skipped}，复制凭据 ${result.providersCopied}。${warning}`,
      );
      setPreview(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>从其他用户同步</DialogTitle>
          <DialogDescription>
            将来源用户的配置和所引用的凭据复制到 {currentUser || '当前用户'}
            。激活状态、备份和原生配置文件不会复制。
          </DialogDescription>
        </DialogHeader>

        {sources.length > 0 ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="sync-source-user">来源用户</Label>
              <Select
                value={sourceUser}
                onValueChange={(value) => {
                  setSourceUser(value);
                  setPreview(null);
                  setMessage(null);
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
                  <div className="space-y-2">
                    <Label>同名配置处理</Label>
                    <Select
                      value={policy}
                      onValueChange={(value) => setPolicy(value as TransferConflictPolicy)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">保留当前用户配置（跳过）</SelectItem>
                        <SelectItem value="overwrite">用来源配置覆盖</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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

        {message ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {!preview ? (
            <Button disabled={!sourceUser || pending} onClick={() => void inspect()}>
              <Copy />
              {pending ? '正在检查…' : '检查可同步内容'}
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => void synchronize()}>
              <Copy />
              {pending ? '正在同步…' : `同步到 ${currentUser}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
