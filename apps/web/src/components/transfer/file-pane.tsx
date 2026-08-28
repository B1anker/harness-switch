import type { TransferEnvelope, TransferPreview } from '@seaveyon/harness-switch-shared';
import { Download, FileLock2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { buildImportNotice, ImportReview } from '@/components/import-review';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useTransferImport } from '@/lib/use-transfer-import';
import { useAppStore } from '@/stores/app-store';

const MIN_PASSPHRASE = 8;

/** Both directions of the portable encrypted package. */
type Direction = 'export' | 'import';

/**
 * The `.hsw-backup` source: an AES-256-GCM package encrypted with a passphrase the
 * receiving machine has to know, so it never depends on either machine's local key.
 */
export function FilePane({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const setNotice = useAppStore((state) => state.setNotice);
  const fileInput = useRef<HTMLInputElement>(null);

  const [direction, setDirection] = useState<Direction>('import');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<MessageLine | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [envelope, setEnvelope] = useState<TransferEnvelope | null>(null);
  const [fileName, setFileName] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [fileError, setFileError] = useState<MessageLine | null>(null);

  const transfer = useTransferImport({
    fetchPreview: (options) =>
      api<TransferPreview>('/api/transfer/preview', {
        method: 'POST',
        body: JSON.stringify({ envelope, passphrase: importPassphrase, ...options }),
      }),
    runImport: (options) =>
      api('/api/transfer/import', {
        method: 'POST',
        body: JSON.stringify({
          envelope,
          passphrase: importPassphrase,
          ...options,
          migrateCodexLoginCache: true,
        }),
      }),
    onImported: async (result) => {
      await loadHarnesses();
      setNotice(buildImportNotice(t, result));
      onDone();
    },
  });

  async function exportAll() {
    setExporting(true);
    setExportError(null);
    setMessage(null);
    try {
      const result = await api<TransferEnvelope>('/api/transfer/export', {
        method: 'POST',
        body: JSON.stringify({ passphrase: exportPassphrase, includeCodexLoginCache: true }),
      });
      downloadEnvelope(result);
      setMessage(t('transfer.exported'));
    } catch (caught) {
      setExportError(errorLine(caught));
    } finally {
      setExporting(false);
    }
  }

  async function readFile(file: File | undefined) {
    transfer.reset();
    setFileError(null);
    setMessage(null);
    if (!file) {
      setEnvelope(null);
      setFileName('');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as TransferEnvelope;
      if (parsed.format !== 'harness-switch-encrypted-export' || parsed.version !== 1) {
        setFileError({ key: 'transfer.notAnExport' });
        setEnvelope(null);
        setFileName('');
        return;
      }
      setEnvelope(parsed);
      setFileName(file.name);
    } catch (caught) {
      setEnvelope(null);
      setFileName('');
      setFileError(errorLine(caught));
    }
  }

  const canExport =
    exportPassphrase.length >= MIN_PASSPHRASE &&
    exportPassphrase === exportConfirmation &&
    !exporting;
  const canPreview =
    envelope !== null && importPassphrase.length >= MIN_PASSPHRASE && transfer.pending === null;
  const error = direction === 'export' ? exportError : (fileError ?? transfer.error);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
        {(['import', 'export'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={direction === value}
            className={
              direction === value
                ? 'flex items-center justify-center gap-2 rounded-md bg-background py-1.5 text-sm font-medium text-foreground shadow-sm'
                : 'flex cursor-pointer items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
            }
            onClick={() => setDirection(value)}
          >
            {value === 'import' ? <Upload className="size-4" /> : <Download className="size-4" />}
            {value === 'import' ? t('transfer.importTitle') : t('transfer.exportTitle')}
          </button>
        ))}
      </div>

      {direction === 'export' ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('transfer.exportIntro')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="export-passphrase">{t('transfer.passphrase')}</Label>
              <Input
                id="export-passphrase"
                type="password"
                autoComplete="new-password"
                value={exportPassphrase}
                onChange={(event) => setExportPassphrase(event.target.value)}
                placeholder={t('transfer.passphrasePlaceholder', { min: MIN_PASSPHRASE })}
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
          <Button type="button" onClick={() => void exportAll()} disabled={!canExport}>
            <Download />
            {exporting ? t('transfer.encrypting') : t('transfer.download')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('transfer.importIntro')}
          </p>

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
                  transfer.invalidate();
                }}
                placeholder={t('transfer.importPassphrasePlaceholder')}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview}
              onClick={() => void transfer.inspect()}
            >
              {transfer.pending === 'preview' ? t('transfer.inspecting') : t('transfer.inspect')}
            </Button>
          </div>

          {transfer.preview ? (
            <ImportReview
              idPrefix="file"
              preview={transfer.preview}
              conflictPolicy={transfer.conflictPolicy}
              restoreActive={transfer.restoreActive}
              stale={transfer.stale}
              pending={transfer.pending === 'import'}
              canImport={transfer.canImport}
              onPolicyChange={transfer.changePolicy}
              onRestoreActiveChange={transfer.changeRestoreActive}
              onConfirm={() => void transfer.confirm()}
            />
          ) : null}
        </div>
      )}

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
    </div>
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
