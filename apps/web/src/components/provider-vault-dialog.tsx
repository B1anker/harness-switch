import type { ProviderPublic } from '@seaveyon/harness-switch-shared';
import { ChevronLeft, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/app-store';

type ProviderVaultDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; entry: ProviderPublic };

type EndpointDraft = {
  key: string;
  baseUrl: string;
  label: string;
};

/**
 * Provider Vault: one place to see every stored provider entry (name, key
 * status, endpoints) and to rotate credentials or edit endpoints. The server
 * never returns key material, so the list only shows metadata and rotation is
 * done by submitting a new key.
 */
export function ProviderVaultDialog({ open, onOpenChange }: ProviderVaultDialogProps) {
  const providers = useAppStore((state) => state.providers);
  const providersLoading = useAppStore((state) => state.providersLoading);
  const providersError = useAppStore((state) => state.providersError);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderPublic | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Plaintext keys the user chose to reveal, keyed by entry id. */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealProvider = useAppStore((state) => state.revealProvider);

  async function confirmDelete(entry: ProviderPublic) {
    setDeleteError(null);
    try {
      await deleteProvider(entry.id);
      setPendingDelete(null);
      setMessage('已删除。');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function toggleReveal(entry: ProviderPublic) {
    if (revealed[entry.id] !== undefined) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      return;
    }
    try {
      const { apiKey } = await revealProvider(entry.id);
      setRevealed((current) => ({ ...current, [entry.id]: apiKey }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取密钥');
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setView({ kind: 'list' });
    setMessage(null);
    setError(null);
    setDeleteError(null);
    if (providers === null) {
      void loadProviders();
    }
  }, [open, providers, loadProviders]);

  const entries = providers ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>凭据库</DialogTitle>
          <DialogDescription>
            Provider 条目集中保存 API Key（AES-256-GCM 加密，默认不显示明文），并附带可复用的
            endpoint。配置档案可以引用这里的条目，而不是各自保存一份密钥。
          </DialogDescription>
        </DialogHeader>

        {providersLoading && entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在读取凭据库…</p>
        ) : null}
        {providersError ? <p className="text-sm text-destructive">{providersError}</p> : null}

        {view.kind === 'create' || view.kind === 'edit' ? (
          <EntryForm
            entry={view.kind === 'edit' ? view.entry : null}
            onCancel={() => {
              setView({ kind: 'list' });
              setError(null);
            }}
            onSaved={(text) => {
              setView({ kind: 'list' });
              setMessage(text);
              setError(null);
            }}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{entries.length} 个 Provider 条目</p>
              <Button size="sm" onClick={() => setView({ kind: 'create' })}>
                <Plus />
                新增凭据
              </Button>
            </div>
            {message ? (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                {message}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                凭据库为空，先新增一个 Provider。
              </p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{entry.name}</p>
                          {entry.apiKeyConfigured ? (
                            <Badge variant="secondary">密钥已配置</Badge>
                          ) : (
                            <Badge variant="outline">未配置密钥</Badge>
                          )}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {formatTime(entry.updatedAt)}
                          </span>
                        </div>
                        {entry.notes ? (
                          <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>
                        ) : null}
                        {entry.endpoints.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {entry.endpoints.map((endpoint) => (
                              <li
                                key={endpoint.key}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                              >
                                <code className="font-mono text-xs">{endpoint.key}</code>
                                <span className="break-all font-mono text-[11px] text-muted-foreground">
                                  {endpoint.baseUrl}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">没有命名 endpoint</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${revealed[entry.id] !== undefined ? '隐藏' : '显示'} ${entry.name} 的密钥`}
                          onClick={() => void toggleReveal(entry)}
                        >
                          {revealed[entry.id] !== undefined ? <EyeOff /> : <Eye />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`编辑 ${entry.name}`}
                          onClick={() => {
                            setView({ kind: 'edit', entry });
                            setError(null);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`删除 ${entry.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(entry);
                          }}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {revealed[entry.id] !== undefined ? (
                      <p className="mt-2 break-all rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">
                        {revealed[entry.id]}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个 Provider？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{pendingDelete?.name}」。被配置档案引用的条目无法删除，请先移除引用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive">被引用无法删除：{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog open on failure so the 409 reason is visible;
                // confirmDelete closes it explicitly on success.
                event.preventDefault();
                if (pendingDelete) {
                  void confirmDelete(pendingDelete);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

type EntryFormProps = {
  /** null creates a new entry; otherwise the entry being edited. */
  entry: ProviderPublic | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
};

function EntryForm({ entry, onCancel, onSaved }: EntryFormProps) {
  const createProvider = useAppStore((state) => state.createProvider);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const isEdit = entry !== null;
  const [name, setName] = useState(entry?.name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(() =>
    (entry?.endpoints ?? []).map((endpoint) => ({
      key: endpoint.key,
      baseUrl: endpoint.baseUrl,
      label: endpoint.label,
    })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateEndpoint(index: number, patch: Partial<EndpointDraft>) {
    setEndpoints((current) =>
      current.map((endpoint, i) => (i === index ? { ...endpoint, ...patch } : endpoint)),
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const complete = endpoints.filter((endpoint) => endpoint.key.trim() && endpoint.baseUrl.trim());
    const body = {
      name,
      notes: notes.trim() || undefined,
      endpoints: complete.map((endpoint) => ({
        key: endpoint.key.trim(),
        label: endpoint.label.trim(),
        baseUrl: endpoint.baseUrl.trim(),
      })),
    };
    setPending(true);
    setError(null);
    try {
      if (isEdit && entry) {
        const result = await updateProvider(entry.id, {
          ...body,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
        const parts = ['已更新。'];
        if (result.warnings.length > 0) {
          parts.push(result.warnings.join('；'));
        }
        onSaved(parts.join(' '));
      } else {
        await createProvider({ ...body, apiKey: apiKey.trim() });
        onSaved('已新增 Provider 条目。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={onCancel}
      >
        <ChevronLeft className="size-3.5" />
        返回凭据库
      </button>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-name">名称</Label>
          <Input
            id="provider-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：openrouter"
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-api-key">API Key</Label>
          <Input
            id="provider-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={isEdit ? '留空表示保持不变' : '必填'}
            required={!isEdit}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-notes">备注（可选）</Label>
          <Textarea
            id="provider-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>命名 Endpoint（可选）</Label>
        <p className="text-xs text-muted-foreground">
          配置档案引用此 Provider 时可以选择某个 endpoint，其 Base URL 优先于配置自身的地址。
        </p>
        {endpoints.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
            还没有 endpoint
          </p>
        ) : (
          <div className="space-y-2">
            {endpoints.map((endpoint, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <Input
                  aria-label={`Endpoint ${index + 1} 名称`}
                  value={endpoint.key}
                  onChange={(event) => updateEndpoint(index, { key: event.target.value })}
                  placeholder="名称"
                />
                <Input
                  aria-label={`Endpoint ${index + 1} Base URL`}
                  value={endpoint.baseUrl}
                  onChange={(event) => updateEndpoint(index, { baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />
                <Input
                  aria-label={`Endpoint ${index + 1} 标签`}
                  value={endpoint.label}
                  onChange={(event) => updateEndpoint(index, { label: event.target.value })}
                  placeholder="标签（可选）"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`移除 Endpoint ${index + 1}`}
                  onClick={() => setEndpoints((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setEndpoints((current) => [...current, { key: '', baseUrl: '', label: '' }])
          }
        >
          <Plus />
          添加 endpoint
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : isEdit ? '保存修改' : '新增凭据'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
