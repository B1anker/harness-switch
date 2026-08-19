import {
  HARNESS_LABELS,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
import { Download, FileLock2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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

type TransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TransferDialog({ open, onOpenChange }: TransferDialogProps) {
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [envelope, setEnvelope] = useState<TransferEnvelope | null>(null);
  const [fileName, setFileName] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<TransferConflictPolicy>('skip');
  const [restoreActive, setRestoreActive] = useState(true);
  const [pending, setPending] = useState<'export' | 'preview' | 'import' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportAll() {
    setPending('export');
    setError(null);
    setMessage(null);
    try {
      const result = await api<TransferEnvelope>('/api/transfer/export', {
        method: 'POST',
        body: JSON.stringify({ passphrase: exportPassphrase }),
      });
      downloadEnvelope(result);
      setMessage('加密导出包已生成。迁移密码不会写入文件，请单独保管。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function readFile(file: File | undefined) {
    setPreview(null);
    setMessage(null);
    setError(null);
    if (!file) {
      setEnvelope(null);
      setFileName('');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as TransferEnvelope;
      if (parsed.format !== 'harness-switch-encrypted-export' || parsed.version !== 1) {
        throw new Error('不是有效的 harness-switch 导出文件');
      }
      setEnvelope(parsed);
      setFileName(file.name);
    } catch (err) {
      setEnvelope(null);
      setFileName('');
      setError((err as Error).message);
    }
  }

  async function inspectImport() {
    if (!envelope) {
      return;
    }
    setPending('preview');
    setError(null);
    setMessage(null);
    try {
      const result = await api<TransferPreview>('/api/transfer/preview', {
        method: 'POST',
        body: JSON.stringify({ envelope, passphrase: importPassphrase }),
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function importAll() {
    if (!envelope || !preview) {
      return;
    }
    setPending('import');
    setError(null);
    try {
      const result = await api<TransferImportResponse>('/api/transfer/import', {
        method: 'POST',
        body: JSON.stringify({
          envelope,
          passphrase: importPassphrase,
          conflictPolicy,
          restoreActive,
        }),
      });
      await loadHarnesses();
      const parts = [`新增 ${result.imported} 项`];
      if (result.overwritten > 0) parts.push(`覆盖 ${result.overwritten} 项`);
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 项`);
      if (result.activeRestored > 0) parts.push(`恢复 ${result.activeRestored} 个激活状态`);
      setMessage(`导入完成：${parts.join('，')}。${result.warnings.join('；')}`);
      setPreview(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  const canExport =
    exportPassphrase.length >= 8 && exportPassphrase === exportConfirmation && pending === null;
  const canPreview = envelope !== null && importPassphrase.length >= 8 && pending === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>全局配置迁移</DialogTitle>
          <DialogDescription>
            将全部 Harness 配置、API Key、原始文件覆盖内容和激活状态打包，供其他机器复用。
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4 rounded-2xl border bg-muted/25 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">导出所有配置</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                文件使用迁移密码进行 AES-256-GCM 加密，不依赖当前机器的本地密钥。
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="export-passphrase">迁移密码</Label>
              <Input
                id="export-passphrase"
                type="password"
                autoComplete="new-password"
                value={exportPassphrase}
                onChange={(event) => setExportPassphrase(event.target.value)}
                placeholder="至少 8 个字符"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-passphrase-confirm">确认迁移密码</Label>
              <Input
                id="export-passphrase-confirm"
                type="password"
                autoComplete="new-password"
                value={exportConfirmation}
                onChange={(event) => setExportConfirmation(event.target.value)}
                placeholder="再次输入"
              />
            </div>
          </div>
          {exportConfirmation && exportPassphrase !== exportConfirmation ? (
            <p className="text-xs text-destructive">两次输入的迁移密码不一致。</p>
          ) : null}
          <Button type="button" onClick={() => void exportAll()} disabled={!canExport}>
            <Download />
            {pending === 'export' ? '正在加密…' : '下载加密导出包'}
          </Button>
        </section>

        <section className="space-y-4 rounded-2xl border p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">导入到当前机器</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                先解密并检查冲突，确认后才会写入。默认保留当前机器上的同名配置。
              </p>
            </div>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".hsw-backup,application/json"
            className="sr-only"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-muted/20 px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            onClick={() => fileInput.current?.click()}
          >
            <FileLock2 className="size-5 text-primary" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {fileName || '选择 .hsw-backup 文件'}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                文件内容在本机服务端解密，不会发送到外部服务。
              </span>
            </span>
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="import-passphrase">迁移密码</Label>
              <Input
                id="import-passphrase"
                type="password"
                value={importPassphrase}
                onChange={(event) => {
                  setImportPassphrase(event.target.value);
                  setPreview(null);
                }}
                placeholder="导出时设置的密码"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview}
              onClick={() => void inspectImport()}
            >
              {pending === 'preview' ? '正在检查…' : '检查导入内容'}
            </Button>
          </div>

          {preview ? (
            <div className="space-y-4 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{preview.profileCount} 个配置</Badge>
                <Badge variant={preview.conflicts.length > 0 ? 'outline' : 'secondary'}>
                  {preview.conflicts.length} 个同名冲突
                </Badge>
                <Badge variant="secondary">{preview.activeCount} 个激活状态</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {preview.harnesses.map((item) => (
                  <span key={item.harness}>
                    {HARNESS_LABELS[item.harness]}：{item.profiles}
                  </span>
                ))}
              </div>
              {preview.conflicts.length > 0 ? (
                <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  同名项：
                  {preview.conflicts
                    .map((item) => `${HARNESS_LABELS[item.harness]} / ${item.name}`)
                    .join('、')}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="conflict-policy">同名配置处理</Label>
                  <Select
                    value={conflictPolicy}
                    onValueChange={(value) => setConflictPolicy(value as TransferConflictPolicy)}
                  >
                    <SelectTrigger id="conflict-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">保留本机配置，跳过导入</SelectItem>
                      <SelectItem value="overwrite">使用导出包覆盖本机配置</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={restoreActive}
                    onChange={(event) => setRestoreActive(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  恢复导出时的激活状态
                </label>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" disabled={pending !== null}>
                    <Upload />
                    确认导入
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认导入全部配置？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将导入 {preview.profileCount} 个配置。
                      {conflictPolicy === 'overwrite' && preview.conflicts.length > 0
                        ? `其中 ${preview.conflicts.length} 个同名配置会被覆盖。`
                        : '同名配置会保留，不会被覆盖。'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void importAll()}>
                      {conflictPolicy === 'overwrite' ? '覆盖并导入' : '安全导入'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </section>

        {message ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function downloadEnvelope(envelope: TransferEnvelope): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `harness-switch-${date}.hsw-backup`;
  anchor.click();
  URL.revokeObjectURL(url);
}
