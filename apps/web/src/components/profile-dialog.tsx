import type {
  FieldSpec,
  HarnessSummary,
  PreviewTarget,
  ProbeResult,
  ProfilePublic,
} from '@seaveyon/harness-switch-shared';
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProbeResultLine } from '@/components/probe-result-line';
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
import { errorLine, lineText, type MessageLine, specText } from '@/lib/messages';
import { PRESETS, type Preset } from '@/lib/presets';
import { useAppStore } from '@/stores/app-store';

type ProfileDialogProps = {
  harness: HarnessSummary;
  /** null creates a new profile; otherwise the profile being edited. */
  profile: ProfilePublic | null;
  onOpenChange: (open: boolean) => void;
};

type ProfileFieldErrors = Record<string, MessageLine | undefined>;

/** Longest profile name the server accepts. */
const NAME_MAX_LENGTH = 120;

/** `oneMKey` is null for tiers with no 1M variant, such as Haiku. */
const CLAUDE_MODEL_ROWS = [
  { role: 'Sonnet', modelKey: 'sonnetModel', nameKey: 'sonnetModelName', oneMKey: 'sonnetModel1m' },
  { role: 'Opus', modelKey: 'opusModel', nameKey: 'opusModelName', oneMKey: 'opusModel1m' },
  { role: 'Fable', modelKey: 'fableModel', nameKey: 'fableModelName', oneMKey: 'fableModel1m' },
  { role: 'Haiku', modelKey: 'haikuModel', nameKey: 'haikuModelName', oneMKey: null },
] as const;

const CLAUDE_SUBAGENT_ROW = {
  modelKey: 'subagentModel',
  oneMKey: 'subagentModel1m',
} as const;

/** Keys the mapping grid renders itself, so they are dropped from the generic field list. */
const CLAUDE_MODEL_FIELD_KEYS = new Set<string>([
  ...CLAUDE_MODEL_ROWS.flatMap(({ modelKey, nameKey, oneMKey }) =>
    oneMKey ? [modelKey, nameKey, oneMKey] : [modelKey, nameKey],
  ),
  CLAUDE_SUBAGENT_ROW.modelKey,
  CLAUDE_SUBAGENT_ROW.oneMKey,
]);

export function ProfileDialog({ harness, profile, onOpenChange }: ProfileDialogProps) {
  const { t } = useTranslation();
  const createProfile = useAppStore((state) => state.createProfile);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const previewProfile = useAppStore((state) => state.previewProfile);
  const providers = useAppStore((state) => state.providers);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const probeDraft = useAppStore((state) => state.probeDraft);
  const probeProfile = useAppStore((state) => state.probeProfile);

  const isEdit = profile !== null;
  const [name, setName] = useState(profile?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(profile?.model ?? '');
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [extras, setExtras] = useState(() => initialExtras(harness.fields, profile));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [providerId, setProviderId] = useState(profile?.providerId ?? '');
  const [providerEndpoint, setProviderEndpoint] = useState(profile?.providerEndpoint ?? '');
  const [advanced, setAdvanced] = useState(false);
  const [targets, setTargets] = useState<PreviewTarget[] | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  /** Opt-in: a completion costs the user a token, so it is never sent unasked. */
  const [testCompletion, setTestCompletion] = useState(false);

  const providerEntries = providers ?? [];
  const selectedProvider = providerEntries.find((entry) => entry.id === providerId) ?? null;
  const selectedEndpoint = selectedProvider?.endpoints.find(
    (endpoint) => endpoint.key === providerEndpoint,
  );
  /** Model ids from the last successful probe; feeds the input's datalist. */
  const catalogModels = probeResult?.ok ? (probeResult.models ?? []) : [];

  // A result describes one exact input combination; editing any of them invalidates it.
  useEffect(() => {
    setProbeResult(null);
  }, [baseUrl, apiKey, providerId, providerEndpoint]);
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

  useEffect(() => {
    if (providers === null) {
      void loadProviders();
    }
  }, [providers, loadProviders]);

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
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
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
  async function onProbe() {
    const url = effectiveBaseUrl().trim();
    if (!url) {
      setFieldErrors((current) => ({
        ...current,
        baseUrl: { key: 'profile.error.baseUrlRequired' },
      }));
      return;
    }
    setProbing(true);
    setError(null);
    setProbeResult(null);
    const trimmedModel = model.trim();
    try {
      let result: ProbeResult;
      if (selectedProvider || apiKey.trim()) {
        result = await probeDraft({
          baseUrl: url,
          ...(selectedProvider ? { providerId } : { apiKey }),
          ...(testCompletion ? { completion: true } : {}),
          ...(testCompletion && trimmedModel ? { model: trimmedModel } : {}),
        });
      } else if (isEdit && profile) {
        // The saved-profile route caches per profile, so an explicit click here means
        // "test it now": refresh bypasses a cached verdict the user just asked to redo.
        result = await probeProfile(
          harness.id,
          profile.name,
          testCompletion
            ? { completion: true, refresh: true, ...(trimmedModel ? { model: trimmedModel } : {}) }
            : undefined,
        );
      } else {
        setFieldErrors((current) => ({
          ...current,
          apiKey: { key: 'profile.error.apiKeyRequired' },
        }));
        return;
      }
      setProbeResult(result);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setProbing(false);
    }
  }

  function validateForm(): boolean {
    const next: ProfileFieldErrors = {};
    const trimmedName = name.trim();

    if (!trimmedName) next.name = { key: 'profile.error.nameRequired' };
    else if (trimmedName.includes('/') || trimmedName.includes('\\'))
      next.name = { key: 'profile.error.nameSlash' };
    else if (trimmedName.length > NAME_MAX_LENGTH)
      next.name = { key: 'profile.error.nameTooLong', params: { max: NAME_MAX_LENGTH } };
    if (!effectiveBaseUrl().trim()) next.baseUrl = { key: 'profile.error.baseUrlRequired' };
    if (!isEdit && selectedProvider === null && !apiKey.trim())
      next.apiKey = { key: 'profile.error.apiKeyRequired' };
    if (harness.modelRequired && !model.trim()) next.model = { key: 'profile.error.modelRequired' };
    if (providerMissing) next.providerId = { key: 'profile.error.providerGone' };
    if (endpointMissing) next.providerEndpoint = { key: 'profile.error.endpointGone' };
    for (const field of harness.fields) {
      if (field.required && !extras[field.key]?.trim()) {
        // Resolve the label first: interpolating the raw prose would leave the server's
        // own language sitting inside an otherwise translated sentence.
        next[`extra:${field.key}`] = {
          key: 'profile.error.fieldRequired',
          params: { label: specText(t, field.labelCode, field.label, field.params) },
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
    if (!validateForm()) return;
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
        ...(providerId
          ? { providerId, ...(providerEndpoint ? { providerEndpoint } : {}) }
          : isEdit
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
                    id="provider-select"
                    aria-label={t('profile.useSharedProviderLabel')}
                    aria-invalid={fieldErrors.providerId ? true : undefined}
                    aria-describedby={fieldErrors.providerId ? 'provider-select-error' : undefined}
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
                {fieldErrors.providerId ? (
                  <p id="provider-select-error" className="text-xs text-destructive">
                    {lineText(t, fieldErrors.providerId)}
                  </p>
                ) : null}
                {providerEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('profile.vaultEmpty')}</p>
                ) : null}
                {selectedProvider ? (
                  <div className="space-y-2">
                    <Label htmlFor="provider-endpoint">{t('profile.namedEndpoint')}</Label>
                    <Select
                      value={providerEndpoint}
                      onValueChange={(value) => {
                        setProviderEndpoint(value);
                        clearFieldErrors('providerEndpoint', 'baseUrl');
                      }}
                    >
                      <SelectTrigger
                        id="provider-endpoint"
                        aria-label={t('profile.namedEndpointLabel')}
                        aria-invalid={fieldErrors.providerEndpoint ? true : undefined}
                        aria-describedby={
                          fieldErrors.providerEndpoint ? 'provider-endpoint-error' : undefined
                        }
                      >
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
                    {fieldErrors.providerEndpoint ? (
                      <p id="provider-endpoint-error" className="text-xs text-destructive">
                        {lineText(t, fieldErrors.providerEndpoint)}
                      </p>
                    ) : null}
                    {selectedProvider.endpoints.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('profile.noEndpoints')}</p>
                    ) : null}
                  </div>
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
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name">{t('profile.name')}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      clearFieldErrors('name');
                    }}
                    placeholder={t('profile.namePlaceholder')}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined}
                  />
                  {fieldErrors.name ? (
                    <p id="profile-name-error" className="text-xs text-destructive">
                      {lineText(t, fieldErrors.name)}
                    </p>
                  ) : null}
                  {isEdit ? (
                    <p className="text-xs text-muted-foreground">{t('profile.renameHint')}</p>
                  ) : null}
                </div>
              ) : null}

              {!isDshOfficial ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="baseUrl">{t('profile.baseUrl')}</Label>
                  <Input
                    id="baseUrl"
                    value={
                      selectedProvider && providerEndpoint
                        ? (selectedEndpoint?.baseUrl ?? baseUrl)
                        : baseUrl
                    }
                    onChange={(event) => {
                      setBaseUrl(event.target.value);
                      clearFieldErrors('baseUrl');
                    }}
                    placeholder={t('profile.baseUrlPlaceholder')}
                    disabled={selectedProvider !== null && providerEndpoint !== ''}
                    aria-invalid={fieldErrors.baseUrl ? true : undefined}
                    aria-describedby={fieldErrors.baseUrl ? 'profile-base-url-error' : undefined}
                  />
                  {fieldErrors.baseUrl ? (
                    <p id="profile-base-url-error" className="text-xs text-destructive">
                      {lineText(t, fieldErrors.baseUrl)}
                    </p>
                  ) : null}
                  {selectedProvider && providerEndpoint ? (
                    <p className="text-xs text-muted-foreground">
                      {t('profile.baseUrlFromVault', { endpoint: providerEndpoint })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="apiKey">{t('profile.apiKey')}</Label>
                <Input
                  id="apiKey"
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
                  aria-invalid={fieldErrors.apiKey ? true : undefined}
                  aria-describedby={fieldErrors.apiKey ? 'profile-api-key-error' : undefined}
                />
                {fieldErrors.apiKey ? (
                  <p id="profile-api-key-error" className="text-xs text-destructive">
                    {lineText(t, fieldErrors.apiKey)}
                  </p>
                ) : null}
                {selectedProvider ? (
                  <p className="text-xs text-muted-foreground">{t('profile.apiKeySharedHint')}</p>
                ) : null}
              </div>

              {!isDshOfficial ? (
                <div className="space-y-2">
                  <Label htmlFor="model">
                    {harness.id === 'claude' ? t('profile.fallbackModel') : t('profile.model')}
                  </Label>
                  <Input
                    id="model"
                    value={model}
                    list={catalogModels.length > 0 ? 'profile-model-options' : undefined}
                    onChange={(event) => {
                      setModel(event.target.value);
                      clearFieldErrors('model');
                    }}
                    placeholder={
                      harness.id === 'claude'
                        ? t('profile.fallbackModelPlaceholder')
                        : t('profile.modelPlaceholder')
                    }
                    aria-invalid={fieldErrors.model ? true : undefined}
                    aria-describedby={fieldErrors.model ? 'profile-model-error' : undefined}
                  />
                  {catalogModels.length > 0 ? (
                    <datalist id="profile-model-options">
                      {catalogModels.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                  ) : null}
                  {fieldErrors.model ? (
                    <p id="profile-model-error" className="text-xs text-destructive">
                      {lineText(t, fieldErrors.model)}
                    </p>
                  ) : null}
                  {harness.id === 'claude' ? (
                    <p className="text-xs text-muted-foreground">{t('profile.claudeModelHint')}</p>
                  ) : null}
                </div>
              ) : null}

              {!isDshOfficial ? (
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onProbe}
                      disabled={probing}
                    >
                      {probing ? <Loader2 className="animate-spin" /> : null}
                      {probing ? t('probe.probing') : t('probe.action')}
                    </Button>
                    <label
                      htmlFor="probe-completion"
                      className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Checkbox
                        id="probe-completion"
                        checked={testCompletion}
                        onCheckedChange={(checked) => setTestCompletion(checked === true)}
                      />
                      {t('probe.completionAction')}
                    </label>
                    {probeResult ? <ProbeResultLine result={probeResult} /> : null}
                  </div>
                  {testCompletion ? (
                    <p className="text-xs text-muted-foreground">{t('probe.completionHint')}</p>
                  ) : null}
                  {probeResult?.ok && catalogModels.length > 0 ? (
                    <p className="text-xs text-muted-foreground">{t('probe.catalogHint')}</p>
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

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">{t('profile.notes')}</Label>
                <Textarea
                  id="notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
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

            {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
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

function RawEditor({
  targets,
  overrides,
  onEdit,
  onReset,
}: {
  targets: PreviewTarget[] | null;
  overrides: Record<string, string>;
  onEdit: (key: string, content: string) => void;
  onReset: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (targets === null) {
    return <p className="text-sm text-muted-foreground">{t('profile.rawLoading')}</p>;
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">{t('profile.rawIntro')}</p>
      {targets.map((target) => {
        const taken = overrides[target.key] !== undefined;
        return (
          <div key={target.key} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`raw-${target.key}`} className="font-mono text-xs">
                {target.path}
              </Label>
              {taken ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => onReset(target.key)}>
                  <RotateCcw />
                  {t('profile.resetToGenerated')}
                </Button>
              ) : null}
            </div>
            <Textarea
              id={`raw-${target.key}`}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              value={overrides[target.key] ?? target.content}
              onChange={(event) => onEdit(target.key, event.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}

function PresetRow({
  harnessId,
  onPick,
}: {
  harnessId: HarnessSummary['id'];
  onPick: (preset: Preset) => void;
}) {
  const { t } = useTranslation();
  const presets = PRESETS[harnessId] ?? [];
  if (presets.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('profile.quickFill')}</span>
      {presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPick(preset)}
        >
          {t(`preset.${preset.id}`)}
        </Button>
      ))}
    </div>
  );
}

function ExtraField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  error?: MessageLine;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = `extra-${field.key}`;
  const label = specText(t, field.labelCode, field.label, field.params);
  const placeholder = field.placeholder
    ? specText(t, field.placeholderCode, field.placeholder, field.params)
    : undefined;
  return (
    <div
      className={
        field.kind === 'textarea' || field.fullWidth ? 'space-y-2 sm:col-span-2' : 'space-y-2'
      }
    >
      <Label htmlFor={id}>{label}</Label>
      {field.kind === 'select' ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          >
            <SelectValue placeholder={placeholder ?? t('profile.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {specText(t, option.labelCode, option.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === 'textarea' ? (
        <Textarea
          id={id}
          rows={3}
          value={value}
          placeholder={placeholder}
          className="font-mono text-xs"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={field.kind === 'password' ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {lineText(t, error)}
        </p>
      ) : null}
      {field.help ? (
        <p className="text-xs text-muted-foreground">
          {specText(t, field.helpCode, field.help, field.params)}
        </p>
      ) : null}
    </div>
  );
}

/** Shared column template so the header row and every mapping row stay aligned. */
const CLAUDE_MAPPING_COLUMNS = 'md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_8.5rem]';
/** A mapping row: a bordered card on narrow screens, a bare grid row from md up. */
const CLAUDE_MAPPING_ROW = `grid gap-2 rounded-lg border bg-card/70 p-3 ${CLAUDE_MAPPING_COLUMNS} md:items-start md:gap-3 md:border-0 md:bg-transparent md:p-0`;

function ClaudeModelMappingFields({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: FieldSpec[];
  values: Record<string, string>;
  errors: ProfileFieldErrors;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const subagentField = fieldByKey.get(CLAUDE_SUBAGENT_ROW.modelKey);

  return (
    <section
      data-slot="claude-model-mapping"
      className="space-y-4 rounded-xl border bg-muted/15 p-4 sm:col-span-2 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{t('profile.mapping.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('profile.mapping.intro')}</p>
      </div>

      <div
        className={`hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid ${CLAUDE_MAPPING_COLUMNS}`}
      >
        <span>{t('profile.mapping.role')}</span>
        <span>{t('profile.mapping.displayName')}</span>
        <span>{t('profile.mapping.actualModel')}</span>
        <span>{t('profile.mapping.oneM')}</span>
      </div>

      <div className="space-y-3">
        {CLAUDE_MODEL_ROWS.map(({ role, modelKey, nameKey, oneMKey }) => {
          const modelField = fieldByKey.get(modelKey);
          const nameField = fieldByKey.get(nameKey);
          if (!modelField || !nameField) return null;
          const modelError = errors[`extra:${modelKey}`];
          const nameError = errors[`extra:${nameKey}`];
          return (
            <div key={role} className={CLAUDE_MAPPING_ROW}>
              <div className="flex h-10 items-center rounded-lg border bg-muted/45 px-3 text-sm font-medium">
                {role}
                {modelField.required ? <span className="ml-1 text-destructive">*</span> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`extra-${nameKey}`} className="text-xs md:sr-only">
                  {specText(t, nameField.labelCode, nameField.label, nameField.params)}
                </Label>
                <Input
                  id={`extra-${nameKey}`}
                  value={values[nameKey] ?? ''}
                  placeholder={
                    values[modelKey]?.trim()
                      ? t('profile.mapping.defaultTo', { model: values[modelKey].trim() })
                      : nameField.placeholder &&
                        specText(
                          t,
                          nameField.placeholderCode,
                          nameField.placeholder,
                          nameField.params,
                        )
                  }
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? `extra-${nameKey}-error` : undefined}
                  onChange={(event) => onChange(nameKey, event.target.value)}
                />
                {nameError ? (
                  <p id={`extra-${nameKey}-error`} className="text-xs text-destructive">
                    {lineText(t, nameError)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`extra-${modelKey}`} className="text-xs md:sr-only">
                  {specText(t, modelField.labelCode, modelField.label, modelField.params)}
                </Label>
                <Input
                  id={`extra-${modelKey}`}
                  value={values[modelKey] ?? ''}
                  placeholder={
                    modelField.placeholder &&
                    specText(
                      t,
                      modelField.placeholderCode,
                      modelField.placeholder,
                      modelField.params,
                    )
                  }
                  aria-invalid={modelError ? true : undefined}
                  aria-describedby={modelError ? `extra-${modelKey}-error` : undefined}
                  onChange={(event) => onChange(modelKey, event.target.value)}
                />
                {modelError ? (
                  <p id={`extra-${modelKey}-error`} className="text-xs text-destructive">
                    {lineText(t, modelError)}
                  </p>
                ) : null}
              </div>
              <OneMCell
                role={role}
                field={oneMKey ? fieldByKey.get(oneMKey) : undefined}
                value={oneMKey ? values[oneMKey] : undefined}
                error={oneMKey ? errors[`extra:${oneMKey}`] : undefined}
                onChange={onChange}
              />
            </div>
          );
        })}

        {subagentField ? (
          <div className={CLAUDE_MAPPING_ROW}>
            <div className="flex h-10 items-center rounded-lg border bg-muted/45 px-3 text-sm font-medium">
              Subagent
            </div>
            <div className="flex h-10 items-center rounded-lg border bg-muted/30 px-3 text-sm text-muted-foreground">
              {t('profile.mapping.notInMenu')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="extra-subagentModel" className="text-xs md:sr-only">
                {specText(t, subagentField.labelCode, subagentField.label, subagentField.params)}
              </Label>
              <Input
                id="extra-subagentModel"
                value={values.subagentModel ?? ''}
                placeholder={
                  subagentField.placeholder &&
                  specText(
                    t,
                    subagentField.placeholderCode,
                    subagentField.placeholder,
                    subagentField.params,
                  )
                }
                aria-invalid={errors['extra:subagentModel'] ? true : undefined}
                aria-describedby={
                  errors['extra:subagentModel'] ? 'extra-subagentModel-error' : undefined
                }
                onChange={(event) => onChange('subagentModel', event.target.value)}
              />
              {errors['extra:subagentModel'] ? (
                <p id="extra-subagentModel-error" className="text-xs text-destructive">
                  {lineText(t, errors['extra:subagentModel'])}
                </p>
              ) : null}
            </div>
            <OneMCell
              role="Subagent"
              field={fieldByKey.get(CLAUDE_SUBAGENT_ROW.oneMKey)}
              value={values[CLAUDE_SUBAGENT_ROW.oneMKey]}
              error={errors[`extra:${CLAUDE_SUBAGENT_ROW.oneMKey}`]}
              onChange={onChange}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The 1M column of a mapping row. A tier whose models have no 1M variant — Haiku — gets a
 * spelled-out placeholder instead of a control, so the empty cell reads as "unsupported"
 * rather than "we forgot to render something".
 *
 * The flag is a boolean to the user but a `'true'`/`'false'` string in `extras`, which is
 * what the adapter reads when deciding whether to append the `[1m]` suffix.
 */
function OneMCell({
  role,
  field,
  value,
  error,
  onChange,
}: {
  role: string;
  /** Absent when the server described no 1M field for this tier. */
  field: FieldSpec | undefined;
  value: string | undefined;
  error?: MessageLine;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (!field) {
    return (
      <div
        data-slot="one-m-unsupported"
        className="flex h-10 items-center rounded-lg border border-dashed bg-muted/20 px-3 text-sm text-muted-foreground"
      >
        {t('profile.mapping.oneMUnsupported', { role })}
      </div>
    );
  }
  const id = `extra-${field.key}`;
  const label = specText(t, field.labelCode, field.label, field.params);
  return (
    <div className="space-y-1.5">
      <div className="flex h-10 items-center">
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
        >
          <Checkbox
            id={id}
            checked={value === 'true'}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onCheckedChange={(checked) => onChange(field.key, checked === true ? 'true' : 'false')}
          />
          <span className="md:hidden">{label}</span>
          <span className="hidden md:inline">{t('profile.mapping.enable')}</span>
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {lineText(t, error)}
        </p>
      ) : null}
    </div>
  );
}

function initialExtras(fields: FieldSpec[], profile: ProfilePublic | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.key] = profile?.extras[field.key] ?? field.defaultValue ?? '';
  }
  return values;
}
