import type { ProviderPublic } from '@seaveyon/harness-switch-shared';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
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
import { useI18n, useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine } from '@/lib/messages';
import { useEnsureLoaded } from '@/lib/use-probe';
import { useAppStore } from '@/stores/app-store';
import { EntryForm } from './entry-form';

type ProviderVaultDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; entry: ProviderPublic };

/**
 * Provider Vault: one place to see every stored provider entry (name, key
 * status, endpoints) and to rotate credentials or edit endpoints. The server
 * never returns key material, so the list only shows metadata and rotation is
 * done by submitting a new key.
 */
export function ProviderVaultDialog({ open, onOpenChange }: ProviderVaultDialogProps) {
  const { locale } = useI18n();
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers);
  const providersLoading = useAppStore((state) => state.providersLoading);
  const providersError = useAppStore((state) => state.providersError);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [message, setMessage] = useState<MessageLine[] | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderPublic | null>(null);
  const [deleteError, setDeleteError] = useState<MessageLine | null>(null);
  /** Plaintext keys the user chose to reveal, keyed by entry id. */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealProvider = useAppStore((state) => state.revealProvider);

  async function confirmDelete(entry: ProviderPublic) {
    setDeleteError(null);
    try {
      await deleteProvider(entry.id);
      setPendingDelete(null);
      setMessage([{ key: 'vault.deleted' }]);
    } catch (err) {
      setDeleteError(errorLineWith(err, 'vault.deleteFailed'));
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
      setError(errorLineWith(err, 'vault.revealFailed'));
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
  }, [open]);

  useEnsureLoaded(providers, loadProviders, open);

  const entries = providers ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {view.kind === 'create'
              ? t('vault.createTitle')
              : view.kind === 'edit'
                ? t('vault.editTitle', { name: view.entry.name })
                : t('vault.title')}
          </DialogTitle>
          <DialogDescription>
            {view.kind === 'list' ? t('vault.intro') : t('vault.formIntro')}
          </DialogDescription>
        </DialogHeader>

        {providersLoading && entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('vault.loading')}</p>
        ) : null}
        {providersError ? <Alert>{lineText(t, providersError)}</Alert> : null}

        {view.kind === 'create' || view.kind === 'edit' ? (
          <EntryForm
            entry={view.kind === 'edit' ? view.entry : null}
            onCancel={() => {
              setView({ kind: 'list' });
              setError(null);
            }}
            onSaved={(lines) => {
              setView({ kind: 'list' });
              setMessage(lines);
              setError(null);
            }}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t('vault.entryCount', { count: entries.length })}
              </p>
              <Button size="sm" onClick={() => setView({ kind: 'create' })}>
                <Plus />
                {t('vault.add')}
              </Button>
            </div>
            {message ? (
              <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                {message.map((line) => (
                  <p key={line.key + line.scope}>{lineText(t, line)}</p>
                ))}
              </div>
            ) : null}
            {error ? <Alert>{lineText(t, error)}</Alert> : null}
            {entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('vault.empty')}</p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{entry.name}</p>
                          {entry.apiKeyConfigured ? (
                            <Badge variant="secondary">{t('vault.keyConfigured')}</Badge>
                          ) : (
                            <Badge variant="outline">{t('vault.keyMissing')}</Badge>
                          )}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {formatTime(entry.updatedAt, locale)}
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
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('vault.noEndpoints')}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={
                            revealed[entry.id] !== undefined
                              ? t('vault.hide', { name: entry.name })
                              : t('vault.reveal', { name: entry.name })
                          }
                          onClick={() => void toggleReveal(entry)}
                        >
                          {revealed[entry.id] !== undefined ? <EyeOff /> : <Eye />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('vault.edit', { name: entry.name })}
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
                          aria-label={t('vault.delete', { name: entry.name })}
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

        {view.kind === 'list' ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('vault.close')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('vault.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('vault.deleteBody', { name: pendingDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <Alert>{lineText(t, deleteError)}</Alert> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
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
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}
