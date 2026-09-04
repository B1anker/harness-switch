import type { ProviderPublic } from '@seaveyon/harness-switch-shared';
import { LIMITS } from '@seaveyon/harness-switch-shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { controlProps, FieldError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine, messageLine } from '@/lib/messages';
import { useProbe } from '@/lib/use-probe';
import { useAppStore } from '@/stores/app-store';
import { VaultProbeRow } from './probe-row';

type EndpointDraft = {
  key: string;
  baseUrl: string;
  label: string;
};

type EndpointFieldErrors = {
  key?: MessageLine;
  baseUrl?: MessageLine;
};

type EntryFormProps = {
  /** null creates a new entry; otherwise the entry being edited. */
  entry: ProviderPublic | null;
  onCancel: () => void;
  /** Confirmation plus any warnings, as lines the list view resolves. */
  onSaved: (message: MessageLine[]) => void;
};

export function EntryForm({ entry, onCancel, onSaved }: EntryFormProps) {
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
  const [probeError, setProbeError] = useState<MessageLine | null>(null);
  /** Which drafted endpoint the probe section targets; defaults to the first. */
  const [probeTarget, setProbeTarget] = useState(0);
  /** Opt-in: a completion costs the user a token, so it is never sent unasked. */
  const [testCompletion, setTestCompletion] = useState(false);

  const endpointsSignature = JSON.stringify(endpoints);
  const probe = useProbe(JSON.stringify([apiKey, endpointsSignature]));
  useEffect(() => setProbeError(null), [apiKey, endpointsSignature]);

  function updateEndpoint(index: number, patch: Partial<EndpointDraft>) {
    setEndpoints((current) =>
      current.map((endpoint, i) => (i === index ? { ...endpoint, ...patch } : endpoint)),
    );
    setEndpointErrors((current) => {
      if (!current[index]) {
        return current;
      }
      const next = { ...current };
      const errors = { ...next[index] };
      if (patch.key !== undefined) {
        delete errors.key;
      }
      if (patch.baseUrl !== undefined) {
        delete errors.baseUrl;
      }
      if (Object.keys(errors).length === 0) {
        delete next[index];
      } else {
        next[index] = errors;
      }
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
      setProbeError({ key: 'probe.missingBaseUrl' });
      return;
    }
    if (!isEdit && !apiKey.trim()) {
      setProbeError(null);
      setFieldErrors((current) => ({ ...current, apiKey: { key: 'vault.error.apiKeyRequired' } }));
      return;
    }
    setProbeError(null);
    try {
      await probe.run(() =>
        probeDraft({
          baseUrl: selected.endpoint.baseUrl,
          ...(apiKey.trim() ? { apiKey } : { providerId: entry?.id ?? '' }),
          // No model is named: a vault entry owns a credential, not a model, so the
          // completion goes to whatever the catalog listed first.
          ...(testCompletion ? { completion: true } : {}),
        }),
      );
    } catch (err) {
      setProbeError(errorLineWith(err, 'vault.probeFailed'));
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
      if (endpoint.key) {
        keyCounts.set(endpoint.key, (keyCounts.get(endpoint.key) ?? 0) + 1);
      }
    }
    const nextEndpointErrors = Object.fromEntries(
      normalizedEndpoints.flatMap((endpoint, index) => {
        const errors: EndpointFieldErrors = {};
        if (!endpoint.key) {
          errors.key = { key: 'vault.error.endpointKeyRequired' };
        } else if (
          endpoint.key.includes('/') ||
          endpoint.key.includes('\\') ||
          endpoint.key.length > LIMITS.endpointKey
        ) {
          errors.key = {
            key: 'vault.error.endpointKeyInvalid',
            params: { max: LIMITS.endpointKey },
          };
        } else if ((keyCounts.get(endpoint.key) ?? 0) > 1) {
          errors.key = { key: 'vault.error.endpointKeyDuplicate' };
        }
        if (!endpoint.baseUrl) {
          errors.baseUrl = { key: 'vault.error.endpointUrlRequired' };
        }
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
        <FormField
          id="provider-name"
          className="sm:col-span-2"
          label={t('vault.name')}
          error={fieldErrors.name ? lineText(t, fieldErrors.name) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFieldErrors((current) => ({ ...current, name: undefined }));
              }}
              placeholder={t('vault.namePlaceholder')}
            />
          )}
        </FormField>
        <FormField
          id="provider-api-key"
          className="sm:col-span-2"
          label={t('vault.apiKey')}
          error={fieldErrors.apiKey ? lineText(t, fieldErrors.apiKey) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setFieldErrors((current) => ({ ...current, apiKey: undefined }));
              }}
              placeholder={isEdit ? t('vault.apiKeyKeep') : t('vault.apiKeyRequiredPlaceholder')}
            />
          )}
        </FormField>
        <FormField id="provider-notes" className="sm:col-span-2" label={t('vault.notes')}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </FormField>
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
                <EndpointCell
                  id={`endpoint-${index}-key`}
                  label={t('vault.endpointKeyLabel', { index: index + 1 })}
                  value={endpoint.key}
                  placeholder={t('vault.endpointKeyPlaceholder')}
                  error={endpointErrors[index]?.key}
                  onChange={(value) => updateEndpoint(index, { key: value })}
                />
                <EndpointCell
                  id={`endpoint-${index}-url`}
                  label={t('vault.endpointUrlLabel', { index: index + 1 })}
                  value={endpoint.baseUrl}
                  placeholder={t('vault.endpointUrlPlaceholder')}
                  error={endpointErrors[index]?.baseUrl}
                  onChange={(value) => updateEndpoint(index, { baseUrl: value })}
                />
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
          probing={probe.pending}
          result={probe.result}
          probeError={probeError}
          completion={testCompletion}
          onCompletionChange={setTestCompletion}
          onProbe={runProbe}
        />
      </div>

      {error ? <Alert>{lineText(t, error)}</Alert> : null}

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

/**
 * An endpoint column. The label is carried by `aria-label` rather than a visible `<label>`
 * because the row's header sits in the grid above it, and repeating it per row would
 * triple the height of an editor that is mostly rows.
 */
function EndpointCell({
  id,
  label,
  value,
  placeholder,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error?: MessageLine;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Input
        {...controlProps(id, error)}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={id}>{error ? lineText(t, error) : undefined}</FieldError>
    </div>
  );
}
