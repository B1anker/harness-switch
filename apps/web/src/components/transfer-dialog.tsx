import {
  HARNESS_LABELS,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferExportPreview,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import { Download, FileLock2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine, messageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type TransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TransferDialog({ open, onOpenChange }: TransferDialogProps) {
  const { t } = useTranslation();
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const setNotice = useAppStore((state) => state.setNotice);
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [exportPreview, setExportPreview] = useState<TransferExportPreview | null>(null);
  const [includeCodexLoginCache, setIncludeCodexLoginCache] = useState(false);
  const [envelope, setEnvelope] = useState<TransferEnvelope | null>(null);
  const [fileName, setFileName] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [migrateCodexLoginCache, setMigrateCodexLoginCache] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<TransferConflictPolicy>('skip');
  const [restoreActive, setRestoreActive] = useState(true);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [pending, setPending] = useState<'export' | 'preview' | 'import' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);

  useEffect(() => {
    if (!open) {
      setIncludeCodexLoginCache(false);
      setMigrateCodexLoginCache(false);
      setPreviewStale(false);
      setConfirmingImport(false);
      return;
    }
    let disposed = false;
    void api<TransferExportPreview>('/api/transfer/export/preview')
      .then((result) => {
        if (disposed) return;
        setExportPreview(result);
        setIncludeCodexLoginCache(result.codexLoginCacheAvailable === true);
      })
      .catch(() => {
        if (!disposed) setExportPreview(null);
      });
    return () => {
      disposed = true;
    };
  }, [open]);

  async function exportAll() {
    setPending('export');
    setError(null);
    setMessage(null);
    try {
      const result = await api<TransferEnvelope>('/api/transfer/export', {
        method: 'POST',
        body: JSON.stringify({
          passphrase: exportPassphrase,
          includeCodexLoginCache,
        }),
      });
      downloadEnvelope(result);
      setMessage(
        includeCodexLoginCache
          ? t('transfer.exportedWithCache')
          : t('transfer.exportedWithoutCache'),
      );
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPending(null);
    }
  }

  async function readFile(file: File | undefined) {
    setPreview(null);
    setPreviewStale(false);
    setConfirmingImport(false);
    setMigrateCodexLoginCache(false);
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
        setError({ key: 'transfer.notAnExport' });
        setEnvelope(null);
        setFileName('');
        return;
      }
      setEnvelope(parsed);
      setFileName(file.name);
    } catch (err) {
      setEnvelope(null);
      setFileName('');
      setError(errorLine(err));
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
        body: JSON.stringify({
          envelope,
          passphrase: importPassphrase,
          conflictPolicy,
          restoreActive,
        }),
      });
      setPreview(result);
      setPreviewStale(false);
      setConfirmingImport(false);
      setMigrateCodexLoginCache(
        result.codexLoginCache?.available === true &&
          result.codexLoginCache.migrationNeeded === true,
      );
    } catch (err) {
      setPreview(null);
      setError(errorLine(err));
    } finally {
      setPending(null);
    }
  }

  async function importAll() {
    if (!envelope || !preview || previewStale) {
      return;
    }
    setConfirmingImport(false);
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
          migrateCodexLoginCache,
        }),
      });
      await loadHarnesses();
      setNotice(buildImportNotice(t, result));
      setPreview(null);
      setPreviewStale(false);
      setMigrateCodexLoginCache(false);
      onOpenChange(false);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPending(null);
    }
  }

  const canExport =
    exportPassphrase.length >= 8 && exportPassphrase === exportConfirmation && pending === null;
  const canPreview = envelope !== null && importPassphrase.length >= 8 && pending === null;
  const previewMatchesOptions =
    preview?.conflictPolicy === conflictPolicy && preview?.restoreActive === restoreActive;
  const canImport = preview !== null && previewMatchesOptions && !previewStale && pending === null;
  const activationEffect =
    preview && previewMatchesOptions && !previewStale
      ? codexActivationEffectText(t, preview.codexActivationAuthEffect)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>{t('transfer.intro')}</DialogDescription>
        </DialogHeader>

        <section className="space-y-4 rounded-2xl border bg-muted/25 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">{t('transfer.exportTitle')}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('transfer.exportIntro')}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="export-passphrase">{t('transfer.passphrase')}</Label>
              <Input
                id="export-passphrase"
                type="password"
                autoComplete="new-password"
                value={exportPassphrase}
                onChange={(event) => setExportPassphrase(event.target.value)}
                placeholder={t('transfer.passphrasePlaceholder', { min: 8 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-passphrase-confirm">{t('transfer.passphraseConfirm')}</Label>
              <Input
                id="export-passphrase-confirm"
                type="password"
                autoComplete="new-password"
                value={exportConfirmation}
                onChange={(event) => setExportConfirmation(event.target.value)}
                placeholder={t('transfer.passphraseConfirmPlaceholder')}
              />
            </div>
          </div>
          {exportConfirmation && exportPassphrase !== exportConfirmation ? (
            <p className="text-xs text-destructive">{t('transfer.passphraseMismatch')}</p>
          ) : null}
          {exportPreview?.codexLoginCacheAvailable ? (
            <label className="block space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <span className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={includeCodexLoginCache}
                  onCheckedChange={(checked) => setIncludeCodexLoginCache(checked === true)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{t('transfer.includeCache')}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {t('transfer.includeCacheHint')}
                  </span>
                </span>
              </span>
            </label>
          ) : exportPreview ? (
            <p className="text-xs text-muted-foreground">{t('transfer.noCacheToExport')}</p>
          ) : null}
          <Button type="button" onClick={() => void exportAll()} disabled={!canExport}>
            <Download />
            {pending === 'export' ? t('transfer.encrypting') : t('transfer.download')}
          </Button>
        </section>

        <section className="space-y-4 rounded-2xl border p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">{t('transfer.importTitle')}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('transfer.importIntro')}
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
                {fileName || t('transfer.pickFile')}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t('transfer.pickFileHint')}
              </span>
            </span>
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="import-passphrase">{t('transfer.passphrase')}</Label>
              <Input
                id="import-passphrase"
                type="password"
                value={importPassphrase}
                onChange={(event) => {
                  setImportPassphrase(event.target.value);
                  setPreview(null);
                  setPreviewStale(false);
                  setConfirmingImport(false);
                  setMigrateCodexLoginCache(false);
                }}
                placeholder={t('transfer.importPassphrasePlaceholder')}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview}
              onClick={() => void inspectImport()}
            >
              {pending === 'preview' ? t('transfer.inspecting') : t('transfer.inspect')}
            </Button>
          </div>

          {preview ? (
            <div className="space-y-4 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t('transfer.profileCount', { count: preview.profileCount })}</Badge>
                <Badge variant="secondary">
                  {t('transfer.providerCount', { count: preview.providerCount })}
                </Badge>
                <Badge variant={preview.conflicts.length > 0 ? 'outline' : 'secondary'}>
                  {t('transfer.conflictCount', { count: preview.conflicts.length })}
                </Badge>
                <Badge variant="secondary">
                  {t('transfer.activeCount', { count: preview.activeCount })}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {preview.harnesses.map((item) => (
                  <span key={item.harness}>
                    {t('transfer.harnessProfiles', {
                      harness: HARNESS_LABELS[item.harness],
                      count: item.profiles,
                    })}
                  </span>
                ))}
              </div>
              {preview.conflicts.length > 0 ? (
                <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {t('transfer.conflictList', {
                    items: preview.conflicts
                      .map((item) => `${HARNESS_LABELS[item.harness]} / ${item.name}`)
                      .join(t('common.listSeparator')),
                  })}
                </div>
              ) : null}
              {preview.codexLoginCache?.available && preview.codexLoginCache.migrationNeeded ? (
                <label className="block space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <span className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      checked={migrateCodexLoginCache}
                      onCheckedChange={(checked) => setMigrateCodexLoginCache(checked === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{t('transfer.migrateCache')}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {t('transfer.migrateCacheHint')}
                      </span>
                    </span>
                  </span>
                  {preview.codexLoginCache?.targetExists ? (
                    <span className="block text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                      {t('transfer.migrateCacheOverwrite')}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {activationEffect ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {activationEffect}
                </div>
              ) : null}
              {previewStale ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t('transfer.previewStale')}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="conflict-policy">{t('transfer.conflictPolicy')}</Label>
                  <Select
                    value={conflictPolicy}
                    onValueChange={(value) => {
                      setConflictPolicy(value as TransferConflictPolicy);
                      setPreviewStale(true);
                      setConfirmingImport(false);
                    }}
                  >
                    <SelectTrigger id="conflict-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">{t('transfer.policySkip')}</SelectItem>
                      <SelectItem value="overwrite">{t('transfer.policyOverwrite')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm">
                  <Checkbox
                    checked={restoreActive}
                    onCheckedChange={(checked) => {
                      setRestoreActive(checked === true);
                      setPreviewStale(true);
                      setConfirmingImport(false);
                    }}
                  />
                  {t('transfer.restoreActive')}
                </label>
              </div>
              <Button type="button" disabled={!canImport} onClick={() => setConfirmingImport(true)}>
                <Upload />
                {previewStale ? t('transfer.recheckNeeded') : t('transfer.confirmImport')}
              </Button>
              <AlertDialog open={confirmingImport} onOpenChange={setConfirmingImport}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {activationEffect
                        ? t('transfer.confirmAuthTitle')
                        : t('transfer.confirmTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('transfer.confirmBody', { count: preview.profileCount })}
                      {conflictPolicy === 'overwrite' && preview.conflicts.length > 0
                        ? t('transfer.confirmOverwrite', { count: preview.conflicts.length })
                        : t('transfer.confirmKeep')}
                      {migrateCodexLoginCache
                        ? preview.codexLoginCache?.targetExists
                          ? t('transfer.confirmCacheOverwrite')
                          : t('transfer.confirmCacheWrite')
                        : t('transfer.confirmCacheSkip')}
                      {activationEffect ? ` ${activationEffect}` : null}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void importAll()}>
                      {activationEffect
                        ? t('transfer.proceedAware')
                        : conflictPolicy === 'overwrite'
                          ? t('transfer.proceedOverwrite')
                          : t('transfer.proceedSafe')}
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
        {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function buildImportNotice(t: TFunction, result: TransferImportResponse): MessageLine[] {
  const parts = [t('transfer.importedCount', { count: result.imported })];
  if (result.overwritten > 0) {
    parts.push(t('transfer.overwrittenCount', { count: result.overwritten }));
  }
  if (result.providersCopied > 0) {
    parts.push(t('transfer.providersCopiedCount', { count: result.providersCopied }));
  }
  if (result.skipped > 0) {
    parts.push(t('transfer.skippedCount', { count: result.skipped }));
  }
  if (result.activeRestored > 0) {
    parts.push(t('transfer.activeRestoredCount', { count: result.activeRestored }));
  }
  parts.push(
    result.codexLoginCacheMigrated ? t('transfer.cacheMigrated') : t('transfer.cacheNotMigrated'),
  );
  return [
    {
      key: 'transfer.importedSummary',
      params: { parts: parts.join(t('common.listSeparator')) },
    },
    ...result.warnings.map((warning) => messageLine(warning)),
  ];
}

function codexActivationEffectText(
  t: TFunction,
  effect: TransferPreview['codexActivationAuthEffect'],
): string | null {
  switch (effect) {
    case 'openai-api-key':
      return t('transfer.authEffect.openai-api-key');
    case 'auth-override':
      return t('transfer.authEffect.auth-override');
    case 'official-cleanup':
      return t('transfer.authEffect.official-cleanup');
    case 'none':
      return null;
  }
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
