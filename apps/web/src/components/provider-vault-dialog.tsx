import type { ProbeResult, ProviderPublic } from '@seaveyon/harness-switch-shared';
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProbeResultLine } from '@/components/probe-result-line';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n, useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine, messageLine } from '@/lib/messages';
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

type EndpointFieldErrors = {
  key?: MessageLine;
  baseUrl?: MessageLine;
};

/** Longest endpoint id the server accepts. */
const ENDPOINT_KEY_MAX_LENGTH = 60;

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
    if (providers === null) {
      void loadProviders();
    }
  }, [open, providers, loadProviders]);

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
        {providersError ? (
          <p className="text-sm text-destructive">{lineText(t, providersError)}</p>
        ) : null}

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
            {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
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
          {deleteError ? (
            <p className="text-sm text-destructive">{lineText(t, deleteError)}</p>
          ) : null}
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

type EntryFormProps = {
  /** null creates a new entry; otherwise the entry being edited. */
  entry: ProviderPublic | null;
  onCancel: () => void;
  /** Confirmation plus any warnings, as lines the list view resolves. */
  onSaved: (message: MessageLine[]) => void;
};

function EntryForm({ entry, onCancel, onSaved }: EntryFormProps) {
  const { t } = useTranslation();
  const createProvider = useAppStore((state) => state.createProvider);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const probeDraft = useAppStore((state) => state.probeDraft);
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
  const [error, setError] = useState<MessageLine | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: MessageLine; apiKey?: MessageLine }>({});
  const [endpointErrors, setEndpointErrors] = useState<Record<number, EndpointFieldErrors>>({});
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<MessageLine | null>(null);
  /** Which drafted endpoint the probe section targets; defaults to the first. */
  const [probeTarget, setProbeTarget] = useState(0);

  // A probe result describes one exact input combination; edits invalidate it.
  const endpointsSignature = JSON.stringify(endpoints);
  useEffect(() => {
    setProbeResult(null);
    setProbeError(null);
  }, [apiKey, endpointsSignature]);

  function updateEndpoint(index: number, patch: Partial<EndpointDraft>) {
    setEndpoints((current) =>
      current.map((endpoint, i) => (i === index ? { ...endpoint, ...patch } : endpoint)),
    );
    setEndpointErrors((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      const errors = { ...next[index] };
      if (patch.key !== undefined) delete errors.key;
      if (patch.baseUrl !== undefined) delete errors.baseUrl;
      if (Object.keys(errors).length === 0) delete next[index];
      else next[index] = errors;
      return next;
    });
  }

  /**
   * Tests the credential against one of the drafted endpoint URLs without saving.
   * A typed key is tested as a draft; editing without retyping tests the stored
   * credential by referencing this entry's vault id.
   */
  async function runProbe() {
    // Mirror VaultProbeRow's selection: candidates keep their original endpoint
    // index, so the selector's reported index resolves to the same URL here.
    const candidates = endpoints
      .map((endpoint, index) => ({ endpoint, index }))
      .filter(({ endpoint }) => endpoint.baseUrl.trim() !== '');
    const selected = candidates.find((item) => item.index === probeTarget) ?? candidates[0];
    if (!selected) {
      setProbeResult(null);
      setProbeError({ key: 'probe.missingBaseUrl' });
      return;
    }
    if (!isEdit && !apiKey.trim()) {
      setProbeResult(null);
      setProbeError(null);
      setFieldErrors((current) => ({ ...current, apiKey: { key: 'vault.error.apiKeyRequired' } }));
      return;
    }
    setProbing(true);
    setProbeError(null);
    setProbeResult(null);
    try {
      const result = await probeDraft({
        baseUrl: selected.endpoint.baseUrl,
        ...(apiKey.trim() ? { apiKey } : { providerId: entry?.id ?? '' }),
      });
      setProbeResult(result);
    } catch (err) {
      setProbeError(errorLineWith(err, 'vault.probeFailed'));
    } finally {
      setProbing(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEndpoints = endpoints.map((endpoint) => ({
      key: endpoint.key.trim(),
      label: endpoint.label.trim(),
      baseUrl: endpoint.baseUrl.trim(),
    }));
    const nextFieldErrors = {
      ...(!name.trim() ? { name: { key: 'vault.error.nameRequired' } } : {}),
      ...(!isEdit && !apiKey.trim() ? { apiKey: { key: 'vault.error.apiKeyRequired' } } : {}),
    };
    const keyCounts = new Map<string, number>();
    for (const endpoint of normalizedEndpoints) {
      if (endpoint.key) keyCounts.set(endpoint.key, (keyCounts.get(endpoint.key) ?? 0) + 1);
    }
    const nextEndpointErrors = Object.fromEntries(
      normalizedEndpoints.flatMap((endpoint, index) => {
        const errors: EndpointFieldErrors = {};
        if (!endpoint.key) errors.key = { key: 'vault.error.endpointKeyRequired' };
        else if (
          endpoint.key.includes('/') ||
          endpoint.key.includes('\\') ||
          endpoint.key.length > ENDPOINT_KEY_MAX_LENGTH
        )
          errors.key = {
            key: 'vault.error.endpointKeyInvalid',
            params: { max: ENDPOINT_KEY_MAX_LENGTH },
          };
        else if ((keyCounts.get(endpoint.key) ?? 0) > 1)
          errors.key = { key: 'vault.error.endpointKeyDuplicate' };
        if (!endpoint.baseUrl) errors.baseUrl = { key: 'vault.error.endpointUrlRequired' };
        return Object.keys(errors).length > 0 ? [[index, errors] as const] : [];
      }),
    );
    setFieldErrors(nextFieldErrors);
    setEndpointErrors(nextEndpointErrors);
    if (Object.keys(nextFieldErrors).length > 0 || Object.keys(nextEndpointErrors).length > 0) {
      setError({ key: 'vault.error.checkFields' });
      return;
    }
    const body = {
      name: name.trim(),
      notes: notes.trim() || undefined,
      endpoints: normalizedEndpoints,
    };
    setPending(true);
    setError(null);
    try {
      if (isEdit && entry) {
        const result = await updateProvider(entry.id, {
          ...body,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
        onSaved([{ key: 'vault.updated' }, ...result.warnings.map(messageLine)]);
      } else {
        await createProvider({ ...body, apiKey: apiKey.trim() });
        onSaved([{ key: 'vault.created' }]);
      }
    } catch (err) {
      setError(errorLineWith(err, 'vault.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-name">{t('vault.name')}</Label>
          <Input
            id="provider-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors((current) => ({ ...current, name: undefined }));
            }}
            placeholder={t('vault.namePlaceholder')}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? 'provider-name-error' : undefined}
          />
          {fieldErrors.name ? (
            <p id="provider-name-error" className="text-xs text-destructive">
              {lineText(t, fieldErrors.name)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-api-key">{t('vault.apiKey')}</Label>
          <Input
            id="provider-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setFieldErrors((current) => ({ ...current, apiKey: undefined }));
            }}
            placeholder={isEdit ? t('vault.apiKeyKeep') : t('vault.apiKeyRequiredPlaceholder')}
            aria-invalid={fieldErrors.apiKey ? true : undefined}
            aria-describedby={fieldErrors.apiKey ? 'provider-api-key-error' : undefined}
          />
          {fieldErrors.apiKey ? (
            <p id="provider-api-key-error" className="text-xs text-destructive">
              {lineText(t, fieldErrors.apiKey)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="provider-notes">{t('vault.notes')}</Label>
          <Textarea
            id="provider-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('vault.endpoints')}</Label>
        <p className="text-xs text-muted-foreground">{t('vault.endpointsHint')}</p>
        {endpoints.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
            {t('vault.noEndpointDrafts')}
          </p>
        ) : (
          <div className="space-y-2">
            {endpoints.map((endpoint, index) => (
              <div
                key={index}
                className="grid items-start gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <div className="space-y-1.5">
                  <Input
                    aria-label={t('vault.endpointKeyLabel', { index: index + 1 })}
                    value={endpoint.key}
                    onChange={(event) => updateEndpoint(index, { key: event.target.value })}
                    placeholder={t('vault.endpointKeyPlaceholder')}
                    aria-invalid={endpointErrors[index]?.key ? true : undefined}
                    aria-describedby={
                      endpointErrors[index]?.key ? `endpoint-${index}-key-error` : undefined
                    }
                  />
                  {endpointErrors[index]?.key ? (
                    <p id={`endpoint-${index}-key-error`} className="text-xs text-destructive">
                      {lineText(t, endpointErrors[index].key)}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Input
                    aria-label={t('vault.endpointUrlLabel', { index: index + 1 })}
                    value={endpoint.baseUrl}
                    onChange={(event) => updateEndpoint(index, { baseUrl: event.target.value })}
                    placeholder={t('vault.endpointUrlPlaceholder')}
                    aria-invalid={endpointErrors[index]?.baseUrl ? true : undefined}
                    aria-describedby={
                      endpointErrors[index]?.baseUrl ? `endpoint-${index}-url-error` : undefined
                    }
                  />
                  {endpointErrors[index]?.baseUrl ? (
                    <p id={`endpoint-${index}-url-error`} className="text-xs text-destructive">
                      {lineText(t, endpointErrors[index].baseUrl)}
                    </p>
                  ) : null}
                </div>
                <Input
                  aria-label={t('vault.endpointLabelLabel', { index: index + 1 })}
                  value={endpoint.label}
                  onChange={(event) => updateEndpoint(index, { label: event.target.value })}
                  placeholder={t('vault.endpointLabelPlaceholder')}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('vault.removeEndpoint', { index: index + 1 })}
                  onClick={() => {
                    setEndpoints((current) => current.filter((_, i) => i !== index));
                    setEndpointErrors({});
                  }}
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
          {t('vault.addEndpoint')}
        </Button>

        <VaultProbeRow
          options={endpoints
            .map((endpoint, index) => ({ index, key: endpoint.key, baseUrl: endpoint.baseUrl }))
            .filter((option) => option.baseUrl.trim())}
          targetIndex={probeTarget}
          onTargetChange={setProbeTarget}
          hasStoredKey={isEdit}
          hasTypedKey={apiKey.trim().length > 0}
          onMissingKey={() =>
            setFieldErrors((current) => ({
              ...current,
              apiKey: { key: 'vault.error.apiKeyRequired' },
            }))
          }
          probing={probing}
          result={probeResult}
          probeError={probeError}
          onProbe={runProbe}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}

      <DialogFooter className="flex-row justify-end gap-2 space-x-0">
        <Button type="button" variant="outline" className="min-w-24" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="min-w-24" disabled={pending}>
          {pending ? t('vault.saving') : isEdit ? t('vault.saveChanges') : t('vault.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

/** Options for the vault probe row, one per drafted endpoint with a URL. */
type VaultProbeOption = {
  index: number;
  key: string;
  baseUrl: string;
};

/**
 * The vault editor's connectivity row: tests the credential (typed or stored)
 * against one of the drafted endpoint URLs. Presentational — all state and the
 * actual request live in {@link EntryForm}.
 */
function VaultProbeRow({
  options,
  targetIndex,
  onTargetChange,
  hasStoredKey,
  hasTypedKey,
  onMissingKey,
  probing,
  result,
  probeError,
  onProbe,
}: {
  options: VaultProbeOption[];
  targetIndex: number;
  onTargetChange: (index: number) => void;
  hasStoredKey: boolean;
  hasTypedKey: boolean;
  onMissingKey: () => void;
  probing: boolean;
  result: ProbeResult | null;
  probeError?: MessageLine | null;
  onProbe: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  if (options.length === 0 && !hasStoredKey) {
    return null;
  }
  const selected = options.find((option) => option.index === targetIndex) ?? options[0];
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={probing || (options.length === 0 && !hasTypedKey)}
        onClick={() => {
          if (!hasTypedKey && !hasStoredKey) {
            onMissingKey();
            return;
          }
          void onProbe();
        }}
      >
        {probing ? <Loader2 className="animate-spin" /> : null}
        {probing ? t('probe.probing') : t('probe.action')}
      </Button>
      {options.length > 1 ? (
        <Select
          value={String(selected?.index ?? '')}
          onValueChange={(value) => onTargetChange(Number(value))}
        >
          <SelectTrigger className="h-9 w-56" aria-label={t('vault.probeEndpointLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.index} value={String(option.index)}>
                {option.key || option.baseUrl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {probeError ? (
        <span className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="size-4 shrink-0" aria-hidden />
          {lineText(t, probeError)}
        </span>
      ) : result ? (
        <ProbeResultLine result={result} />
      ) : null}
    </div>
  );
}
