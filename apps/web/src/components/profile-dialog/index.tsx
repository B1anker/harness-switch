import type {
  FieldSpec,
  HarnessSummary,
  PreviewTarget,
  ProfilePublic,
} from '@seaveyon/harness-switch-shared';
import { LIMITS } from '@seaveyon/harness-switch-shared';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ProbeResultLine } from '@/components/probe-result-line';
import { Alert } from '@/components/ui/alert';
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
import { controlProps, FieldError, FormField } from '@/components/ui/form-field';
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
import { useTranslation } from '@/lib/i18n';
import { errorLine, fieldText, lineText, type MessageLine, specText } from '@/lib/messages';
import { useEnsureLoaded, useProbe } from '@/lib/use-probe';
import { useAppStore } from '@/stores/app-store';
import { CLAUDE_MODEL_FIELD_KEYS, ClaudeModelMappingFields } from './claude-mapping';
import { ExtraField } from './extra-field';
import { PresetRow } from './preset-row';
import { RawEditor } from './raw-editor';
import type { ProfileFieldErrors } from './types';

type ProfileDialogProps = {
  harness: HarnessSummary;
  /** null creates a new profile; otherwise the profile being edited. */
  profile: ProfilePublic | null;
  /** An existing profile used to prefill a new, independently editable profile. */
  copySource?: ProfilePublic | null;
  onOpenChange: (open: boolean) => void;
};

export function ProfileDialog({
  harness,
  profile,
  copySource = null,
  onOpenChange,
}: ProfileDialogProps) {
  const { t } = useTranslation();
  const createProfile = useAppStore((state) => state.createProfile);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const previewProfile = useAppStore((state) => state.previewProfile);
  const providers = useAppStore((state) => state.providers);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const probeDraft = useAppStore((state) => state.probeDraft);
  const probeProfile = useAppStore((state) => state.probeProfile);

  const isEdit = profile !== null;
  const isCopy = copySource !== null;
  const seed = profile ?? copySource;
  const [name, setName] = useState(
    profile?.name ?? (copySource ? nextCopyName(copySource.name, harness.profiles) : ''),
  );
  const [baseUrl, setBaseUrl] = useState(seed?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(seed?.model ?? '');
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [extras, setExtras] = useState(() => initialExtras(harness.fields, seed));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [providerId, setProviderId] = useState(seed?.providerId ?? '');
  const [providerEndpoint, setProviderEndpoint] = useState(seed?.providerEndpoint ?? '');
  const [advanced, setAdvanced] = useState(false);
  const [targets, setTargets] = useState<PreviewTarget[] | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [probeAction, setProbeAction] = useState<'models' | 'completion' | null>(null);

  const providerEntries = providers ?? [];
  const selectedProvider = providerEntries.find((entry) => entry.id === providerId) ?? null;
  const selectedEndpoint = selectedProvider?.endpoints.find(
    (endpoint) => endpoint.key === providerEndpoint,
  );
  /** Model ids from the last successful catalog request. */
  const probe = useProbe(JSON.stringify([baseUrl, apiKey, providerId, providerEndpoint]));
  const catalogModels = probe.result?.ok ? (probe.result.models ?? []) : [];
  const selectableModels =
    model && !catalogModels.includes(model) ? [model, ...catalogModels] : catalogModels;
  const providerMissing = providers !== null && providerId !== '' && selectedProvider === null;
  const endpointMissing =
    selectedProvider !== null && providerEndpoint !== '' && selectedEndpoint === undefined;
  const dshProviderTypeField =
    harness.id === 'dsh' ? harness.fields.find((field) => field.key === 'providerType') : undefined;
  const isDshOfficial = harness.id === 'dsh' && extras.providerType === 'official';
  const regularFields =
    harness.id === 'claude'
      ? harness.fields.filter((field) => !CLAUDE_MODEL_FIELD_KEYS.has(field.key))
      : harness.id === 'dsh'
        ? harness.fields.filter(
            (field) =>
              field.key !== 'providerType' &&
              (!isDshOfficial || ['models', 'contextWindow', 'maxTokens'].includes(field.key)),
          )
        : harness.fields;
  const fieldsBeforeMapping = isDshOfficial
    ? []
    : harness.id === 'claude'
      ? regularFields.filter((field) => field.key === 'authVar')
      : regularFields;
  const fieldsAfterMapping =
    harness.id === 'claude' ? regularFields.filter((field) => field.key !== 'authVar') : [];

  useEnsureLoaded(providers, loadProviders);

  async function loadPreview() {
    if (!profile) {
      return;
    }
    try {
      const loaded = await previewProfile(harness.id, profile.name);
      setTargets(loaded);
      setOverrides(
        Object.fromEntries(
          loaded
            .filter((target) => target.overridden)
            .map((target) => [target.key, target.content]),
        ),
      );
    } catch (err) {
      setError(errorLine(err));
    }
  }

  function toggleAdvanced() {
    const next = !advanced;
    setAdvanced(next);
    if (next && targets === null) {
      void loadPreview();
    }
  }

  function clearFieldErrors(...keys: string[]) {
    setFieldErrors((current) => {
      if (!keys.some((key) => current[key])) {
        return current;
      }
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  }

  /** The base URL the profile would actually use, vault endpoint included. */
  function effectiveBaseUrl(): string {
    return selectedProvider && providerEndpoint ? (selectedEndpoint?.baseUrl ?? baseUrl) : baseUrl;
  }

  /**
   * Tests the form's current values without saving. A typed inline key is tested as
   * a draft; with a vault entry selected the key resolves server-side; an edit with
   * no new key tests the stored credential.
   */
  async function onProbe(completion = false) {
    const url = effectiveBaseUrl().trim();
    if (!url) {
      setFieldErrors((current) => ({
        ...current,
        baseUrl: { key: 'profile.error.baseUrlRequired' },
      }));
      return;
    }
    const trimmedModel = model.trim();
    if (!selectedProvider && !apiKey.trim() && !(isEdit && profile)) {
      setFieldErrors((current) => ({
        ...current,
        apiKey: { key: 'profile.error.apiKeyRequired' },
      }));
      return;
    }
    setError(null);
    setProbeAction(completion ? 'completion' : 'models');
    try {
      await probe.run(() =>
        selectedProvider || apiKey.trim()
          ? probeDraft({
              baseUrl: url,
              ...(selectedProvider ? { providerId } : { apiKey }),
              ...(completion ? { completion: true } : {}),
              ...(completion && trimmedModel ? { model: trimmedModel } : {}),
            })
          : // The saved-profile route caches per profile, so an explicit click here means
            // "test it now": refresh bypasses a cached verdict the user just asked to redo.
            probeProfile(
              harness.id,
              profile?.name ?? '',
              completion
                ? {
                    completion: true,
                    refresh: true,
                    ...(trimmedModel ? { model: trimmedModel } : {}),
                  }
                : undefined,
            ),
      );
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setProbeAction(null);
    }
  }

  function validateForm(): boolean {
    const next: ProfileFieldErrors = {};
    const trimmedName = name.trim();

    if (!trimmedName) {
      next.name = { key: 'profile.error.nameRequired' };
    } else if (trimmedName.includes('/') || trimmedName.includes('\\')) {
      next.name = { key: 'profile.error.nameSlash' };
    } else if (trimmedName.length > LIMITS.name) {
      next.name = { key: 'profile.error.nameTooLong', params: { max: LIMITS.name } };
    } else if (
      harness.profiles.some((item) => item.name === trimmedName && item.name !== profile?.name)
    ) {
      next.name = { key: 'profile.error.nameDuplicate' };
    }
    if (!effectiveBaseUrl().trim()) {
      next.baseUrl = { key: 'profile.error.baseUrlRequired' };
    }
    if (!isEdit && !isCopy && selectedProvider === null && !apiKey.trim()) {
      next.apiKey = { key: 'profile.error.apiKeyRequired' };
    }
    if (harness.modelRequired && !model.trim()) {
      next.model = { key: 'profile.error.modelRequired' };
    }
    if (providerMissing) {
      next.providerId = { key: 'profile.error.providerGone' };
    }
    if (endpointMissing) {
      next.providerEndpoint = { key: 'profile.error.endpointGone' };
    }
    for (const field of harness.fields) {
      if (field.required && !extras[field.key]?.trim()) {
        // Resolve the label first: interpolating the raw prose would leave the server's
        // own language sitting inside an otherwise translated sentence.
        next[`extra:${field.key}`] = {
          key: 'profile.error.fieldRequired',
          params: { label: fieldText(t, field.labelCode, field.params) },
        };
      }
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      setError({ key: 'profile.error.checkFields' });
      return false;
    }
    return true;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const payload = {
        name: isDshOfficial ? 'deepseek-official' : name,
        baseUrl: isDshOfficial
          ? baseUrl || 'https://api.deepseek.com'
          : selectedProvider && providerEndpoint
            ? (selectedEndpoint?.baseUrl ?? baseUrl)
            : baseUrl,
        model: isDshOfficial ? model || 'deepseek-v4-flash' : model,
        notes,
        extras,
        ...(isCopy ? { copySourceName: copySource.name } : {}),
        ...(providerId
          ? { providerId, ...(providerEndpoint ? { providerEndpoint } : {}) }
          : isEdit || isCopy
            ? { providerId: '' }
            : {}),
        ...(selectedProvider ? {} : { apiKey: apiKey || undefined }),
      };
      if (isEdit) {
        await updateProfile(harness.id, profile.name, { ...payload, overrides });
      } else {
        await createProfile(harness.id, payload);
      }
      onOpenChange(false);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[1120px]">
        <form onSubmit={onSubmit} noValidate className="flex max-h-[92vh] min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b bg-card px-6 py-5 pr-12">
            <DialogTitle>
              {isEdit
                ? t('profile.editTitle', { harness: harness.label, profile: profile.name })
                : isCopy
                  ? t('profile.copyTitle', { harness: harness.label, profile: copySource.name })
                  : t('profile.createTitle', { harness: harness.label })}
            </DialogTitle>
            <DialogDescription>
              {t('profile.intro', {
                targets: harness.targets
                  .map((target) => specText(t, target.labelCode, target.label))
                  .join(t('common.listSeparator')),
              })}
              {harness.mode === 'additive' ? t('profile.additiveNote') : ''}
            </DialogDescription>
          </DialogHeader>

          <div
            data-slot="profile-dialog-scroll"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          >
            {dshProviderTypeField && !(isEdit && isDshOfficial) ? (
              <ExtraField
                field={dshProviderTypeField}
                value={extras.providerType ?? 'custom'}
                onChange={(value) => {
                  setExtras((current) => ({
                    ...current,
                    providerType: value,
                    ...(value === 'official'
                      ? {
                          models:
                            current.models ||
                            'deepseek-v4-flash\ndeepseek-v4-pro\ndeepseek-v4-flash-vision-exp',
                        }
                      : {}),
                  }));
                  if (value === 'official') {
                    setName('deepseek-official');
                    setBaseUrl('https://api.deepseek.com');
                    setModel('deepseek-v4-flash');
                    setProviderId('');
                    setProviderEndpoint('');
                  }
                }}
              />
            ) : null}
            {!isDshOfficial ? (
              <div
                data-slot="provider-reference-fields"
                className="space-y-3 rounded-xl border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="provider-select" className="font-medium">
                    {t('profile.useSharedProvider')}
                  </Label>
                  {selectedProvider ? (
                    <Badge variant="secondary">{t('profile.keyFromVault')}</Badge>
                  ) : null}
                </div>
                <Select
                  value={providerId}
                  onValueChange={(value) => {
                    setProviderId(value);
                    const nextProvider = providerEntries.find((entry) => entry.id === value);
                    setProviderEndpoint(nextProvider?.endpoints[0]?.key ?? '');
                    clearFieldErrors('providerId', 'providerEndpoint', 'baseUrl', 'apiKey');
                  }}
                >
                  <SelectTrigger
                    {...controlProps('provider-select', fieldErrors.providerId)}
                    aria-label={t('profile.useSharedProviderLabel')}
                  >
                    <SelectValue placeholder={t('profile.providerNone')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('profile.providerNone')}</SelectItem>
                    {providerEntries.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="provider-select">
                  {fieldErrors.providerId ? lineText(t, fieldErrors.providerId) : undefined}
                </FieldError>
                {providerEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('profile.vaultEmpty')}</p>
                ) : null}
                {selectedProvider ? (
                  <FormField
                    id="provider-endpoint"
                    label={t('profile.namedEndpoint')}
                    error={
                      fieldErrors.providerEndpoint
                        ? lineText(t, fieldErrors.providerEndpoint)
                        : undefined
                    }
                    hint={selectedProvider.endpoints.length === 0 ? t('profile.noEndpoints') : null}
                  >
                    {(control) => (
                      <Select
                        value={providerEndpoint}
                        onValueChange={(value) => {
                          setProviderEndpoint(value);
                          clearFieldErrors('providerEndpoint', 'baseUrl');
                        }}
                      >
                        <SelectTrigger {...control} aria-label={t('profile.namedEndpointLabel')}>
                          <SelectValue placeholder={t('profile.endpointNone')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{t('profile.endpointNone')}</SelectItem>
                          {selectedProvider.endpoints.map((endpoint) => (
                            <SelectItem key={endpoint.key} value={endpoint.key}>
                              {endpoint.label
                                ? t('profile.endpointOption', {
                                    label: endpoint.label,
                                    key: endpoint.key,
                                  })
                                : endpoint.key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                ) : null}
              </div>
            ) : null}

            {!isDshOfficial ? (
              <PresetRow
                harnessId={harness.id}
                onPick={(preset) => {
                  setBaseUrl(preset.baseUrl);
                  clearFieldErrors('baseUrl');
                  if (preset.model) {
                    setModel(preset.model);
                    clearFieldErrors('model');
                  }
                  if (preset.extras) {
                    setExtras((current) => ({ ...current, ...preset.extras }));
                  }
                }}
              />
            ) : null}

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {!isDshOfficial ? (
                <FormField
                  id="name"
                  className="sm:col-span-2"
                  label={t('profile.name')}
                  error={fieldErrors.name ? lineText(t, fieldErrors.name) : undefined}
                  hint={isEdit ? t('profile.renameHint') : null}
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        clearFieldErrors('name');
                      }}
                      placeholder={t('profile.namePlaceholder')}
                    />
                  )}
                </FormField>
              ) : null}

              {!isDshOfficial ? (
                <FormField
                  id="baseUrl"
                  className="sm:col-span-2"
                  label={t('profile.baseUrl')}
                  error={fieldErrors.baseUrl ? lineText(t, fieldErrors.baseUrl) : undefined}
                  hint={
                    selectedProvider && providerEndpoint
                      ? t('profile.baseUrlFromVault', { endpoint: providerEndpoint })
                      : null
                  }
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={effectiveBaseUrl()}
                      onChange={(event) => {
                        setBaseUrl(event.target.value);
                        clearFieldErrors('baseUrl');
                      }}
                      placeholder={t('profile.baseUrlPlaceholder')}
                      disabled={selectedProvider !== null && providerEndpoint !== ''}
                    />
                  )}
                </FormField>
              ) : null}

              <FormField
                id="apiKey"
                label={t('profile.apiKey')}
                error={fieldErrors.apiKey ? lineText(t, fieldErrors.apiKey) : undefined}
                hint={
                  selectedProvider
                    ? t('profile.apiKeySharedHint')
                    : isDshOfficial
                      ? t('profile.dshOfficialApiKeyHint')
                      : null
                }
              >
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      clearFieldErrors('apiKey');
                    }}
                    placeholder={
                      selectedProvider
                        ? t('profile.keyFromVault')
                        : isEdit
                          ? t('profile.apiKeyKeep')
                          : t('profile.apiKeyRequiredPlaceholder')
                    }
                    disabled={selectedProvider !== null}
                  />
                )}
              </FormField>

              {!isDshOfficial ? (
                <FormField
                  id="model"
                  label={harness.id === 'claude' ? t('profile.fallbackModel') : t('profile.model')}
                  error={fieldErrors.model ? lineText(t, fieldErrors.model) : undefined}
                  hint={harness.id === 'claude' ? t('profile.claudeModelHint') : null}
                >
                  {(control) =>
                    catalogModels.length > 0 ? (
                      <Select
                        value={model}
                        onValueChange={(value) => {
                          setModel(value);
                          clearFieldErrors('model');
                        }}
                      >
                        <SelectTrigger {...control} aria-label={t('profile.model')}>
                          <SelectValue
                            placeholder={
                              harness.id === 'claude'
                                ? t('profile.fallbackModelPlaceholder')
                                : t('profile.modelPlaceholder')
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableModels.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        {...control}
                        value={model}
                        onChange={(event) => {
                          setModel(event.target.value);
                          clearFieldErrors('model');
                        }}
                        placeholder={
                          harness.id === 'claude'
                            ? t('profile.fallbackModelPlaceholder')
                            : t('profile.modelPlaceholder')
                        }
                      />
                    )
                  }
                </FormField>
              ) : null}

              {!isDshOfficial ? (
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onProbe()}
                      disabled={probe.pending}
                    >
                      {probe.pending && probeAction === 'models' ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      {probe.pending && probeAction === 'models'
                        ? t('probe.fetchingModels')
                        : t('probe.fetchModels')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onProbe(true)}
                      disabled={probe.pending}
                    >
                      {probe.pending && probeAction === 'completion' ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      {probe.pending && probeAction === 'completion'
                        ? t('probe.testingCompletion')
                        : t('probe.completionAction')}
                    </Button>
                    {probe.result ? <ProbeResultLine result={probe.result} /> : null}
                  </div>
                  <Alert variant="muted" size="sm">
                    {t('probe.completionHint')}
                  </Alert>
                  {probe.result?.ok && catalogModels.length > 0 ? (
                    <Alert variant="muted" size="sm">
                      {t('probe.catalogHint')}
                    </Alert>
                  ) : null}
                </div>
              ) : null}

              {fieldsBeforeMapping.map((field) => (
                <ExtraField
                  key={field.key}
                  field={field}
                  value={extras[field.key] ?? ''}
                  error={fieldErrors[`extra:${field.key}`]}
                  onChange={(value) => {
                    setExtras((current) => ({ ...current, [field.key]: value }));
                    clearFieldErrors(`extra:${field.key}`);
                  }}
                />
              ))}

              {harness.id === 'claude' ? (
                <ClaudeModelMappingFields
                  fields={harness.fields}
                  values={extras}
                  errors={fieldErrors}
                  modelOptions={catalogModels}
                  onChange={(key, value) => {
                    setExtras((current) => ({ ...current, [key]: value }));
                    clearFieldErrors(`extra:${key}`);
                  }}
                />
              ) : null}

              {fieldsAfterMapping.map((field) => (
                <ExtraField
                  key={field.key}
                  field={field}
                  value={extras[field.key] ?? ''}
                  error={fieldErrors[`extra:${field.key}`]}
                  onChange={(value) => {
                    setExtras((current) => ({ ...current, [field.key]: value }));
                    clearFieldErrors(`extra:${field.key}`);
                  }}
                />
              ))}

              <FormField id="notes" className="sm:col-span-2" label={t('profile.notes')}>
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

            <div className="rounded-xl border">
              <button
                type="button"
                onClick={toggleAdvanced}
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 ${advanced ? 'rounded-t-xl' : 'rounded-xl'}`}
              >
                {advanced ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                {t('profile.advanced')}
                {profile && profile.overriddenTargets.length > 0 ? (
                  <Badge variant="secondary">{t('profile.overridden')}</Badge>
                ) : null}
              </button>
              {advanced ? (
                <div className="space-y-4 border-t px-3 py-3">
                  {isEdit ? (
                    <RawEditor
                      targets={targets}
                      overrides={overrides}
                      onEdit={(key, content) =>
                        setOverrides((current) => ({ ...current, [key]: content }))
                      }
                      onReset={(key) => {
                        setOverrides((current) => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        });
                        void loadPreview();
                      }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('profile.saveFirst')}</p>
                  )}
                </div>
              ) : null}
            </div>

            {error ? <Alert>{lineText(t, error)}</Alert> : null}
          </div>

          <DialogFooter className="shrink-0 border-t bg-card px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('profile.saving') : t('profile.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initialExtras(fields: FieldSpec[], profile: ProfilePublic | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.key] = profile?.extras[field.key] ?? field.defaultValue ?? '';
  }
  return values;
}

/** Pick a usable default without claiming it is reserved until the server saves it. */
function nextCopyName(sourceName: string, profiles: ProfilePublic[]): string {
  const names = new Set(profiles.map((profile) => profile.name));
  const base = `${sourceName}-copy`;
  if (!names.has(base)) {
    return base;
  }
  let suffix = 2;
  while (names.has(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}
