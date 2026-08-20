import type {
  FieldSpec,
  HarnessSummary,
  PreviewTarget,
  ProfilePublic,
} from '@seaveyon/harness-switch-shared';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { PRESETS, type Preset } from '@/lib/presets';
import { useAppStore } from '@/stores/app-store';

type ProfileDialogProps = {
  harness: HarnessSummary;
  /** null creates a new profile; otherwise the profile being edited. */
  profile: ProfilePublic | null;
  onOpenChange: (open: boolean) => void;
};

type ProfileFieldErrors = Record<string, string | undefined>;

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
  const createProfile = useAppStore((state) => state.createProfile);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const previewProfile = useAppStore((state) => state.previewProfile);
  const providers = useAppStore((state) => state.providers);
  const loadProviders = useAppStore((state) => state.loadProviders);

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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});

  const providerEntries = providers ?? [];
  const selectedProvider = providerEntries.find((entry) => entry.id === providerId) ?? null;
  const selectedEndpoint = selectedProvider?.endpoints.find(
    (endpoint) => endpoint.key === providerEndpoint,
  );
  const providerMissing = providers !== null && providerId !== '' && selectedProvider === null;
  const endpointMissing =
    selectedProvider !== null && providerEndpoint !== '' && selectedEndpoint === undefined;
  const regularFields =
    harness.id === 'claude'
      ? harness.fields.filter((field) => !CLAUDE_MODEL_FIELD_KEYS.has(field.key))
      : harness.fields;
  const fieldsBeforeMapping =
    harness.id === 'claude'
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
      setError((err as Error).message);
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

  function validateForm(): boolean {
    const next: ProfileFieldErrors = {};
    const trimmedName = name.trim();
    const effectiveBaseUrl =
      selectedProvider && providerEndpoint ? (selectedEndpoint?.baseUrl ?? baseUrl) : baseUrl;

    if (!trimmedName) next.name = '请输入配置名称';
    else if (trimmedName.includes('/') || trimmedName.includes('\\'))
      next.name = '配置名称不能包含 / 或 \\';
    else if (trimmedName.length > 120) next.name = '配置名称最多 120 个字符';
    if (!effectiveBaseUrl.trim()) next.baseUrl = '请输入 API Base URL';
    if (!isEdit && selectedProvider === null && !apiKey.trim()) next.apiKey = '请输入 API Key';
    if (harness.modelRequired && !model.trim()) next.model = '请输入模型名称';
    if (providerMissing) next.providerId = '引用的 Provider 已不存在，请重新选择';
    if (endpointMissing) next.providerEndpoint = '引用的 Endpoint 已不存在，请重新选择';
    for (const field of harness.fields) {
      if (field.required && !extras[field.key]?.trim()) {
        next[`extra:${field.key}`] = `请填写${field.label}`;
      }
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      setError('请检查标红的必填项或输入内容。');
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
        name,
        baseUrl:
          selectedProvider && providerEndpoint ? (selectedEndpoint?.baseUrl ?? baseUrl) : baseUrl,
        model,
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
      setError((err as Error).message);
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
              {isEdit ? `编辑 ${harness.label} / ${profile.name}` : `新增 ${harness.label} 配置`}
            </DialogTitle>
            <DialogDescription>
              保存后会写入 {harness.targets.map((target) => target.label).join('、')}。
              {harness.mode === 'additive'
                ? '该工具的配置文件按 provider 共存，切换只会移动当前指针，不会删除你手写的其他 provider。'
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div
            data-slot="profile-dialog-scroll"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          >
            <div data-slot="provider-reference-fields" className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="provider-select" className="font-medium">
                  使用共享 Provider（凭据库）
                </Label>
                {selectedProvider ? <Badge variant="secondary">密钥由凭据库提供</Badge> : null}
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
                  aria-label="使用共享 Provider"
                  aria-invalid={fieldErrors.providerId ? true : undefined}
                  aria-describedby={fieldErrors.providerId ? 'provider-select-error' : undefined}
                >
                  <SelectValue placeholder="不使用（本配置自带密钥）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">不使用（本配置自带密钥）</SelectItem>
                  {providerEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.providerId ? (
                <p id="provider-select-error" className="text-xs text-destructive">
                  {fieldErrors.providerId}
                </p>
              ) : null}
              {providerEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  凭据库为空，可先在顶部「凭据库」中新增 Provider 条目。
                </p>
              ) : null}
              {selectedProvider ? (
                <div className="space-y-2">
                  <Label htmlFor="provider-endpoint">命名 Endpoint（可选）</Label>
                  <Select
                    value={providerEndpoint}
                    onValueChange={(value) => {
                      setProviderEndpoint(value);
                      clearFieldErrors('providerEndpoint', 'baseUrl');
                    }}
                  >
                    <SelectTrigger
                      id="provider-endpoint"
                      aria-label="命名 Endpoint"
                      aria-invalid={fieldErrors.providerEndpoint ? true : undefined}
                      aria-describedby={
                        fieldErrors.providerEndpoint ? 'provider-endpoint-error' : undefined
                      }
                    >
                      <SelectValue placeholder="不指定（使用下方 Base URL）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">不指定（使用下方 Base URL）</SelectItem>
                      {selectedProvider.endpoints.map((endpoint) => (
                        <SelectItem key={endpoint.key} value={endpoint.key}>
                          {endpoint.label ? `${endpoint.label}（${endpoint.key}）` : endpoint.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldErrors.providerEndpoint ? (
                    <p id="provider-endpoint-error" className="text-xs text-destructive">
                      {fieldErrors.providerEndpoint}
                    </p>
                  ) : null}
                  {selectedProvider.endpoints.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      该 Provider 没有命名 endpoint，将使用下方 Base URL。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

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

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">配置名称</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearFieldErrors('name');
                  }}
                  placeholder="例如：openrouter-main"
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined}
                />
                {fieldErrors.name ? (
                  <p id="profile-name-error" className="text-xs text-destructive">
                    {fieldErrors.name}
                  </p>
                ) : null}
                {isEdit ? (
                  <p className="text-xs text-muted-foreground">
                    修改后会同步更新当前激活状态和原生配置中的 Provider 标识。
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="baseUrl">API Base URL</Label>
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
                  placeholder="https://api.example.com/v1"
                  disabled={selectedProvider !== null && providerEndpoint !== ''}
                  aria-invalid={fieldErrors.baseUrl ? true : undefined}
                  aria-describedby={fieldErrors.baseUrl ? 'profile-base-url-error' : undefined}
                />
                {fieldErrors.baseUrl ? (
                  <p id="profile-base-url-error" className="text-xs text-destructive">
                    {fieldErrors.baseUrl}
                  </p>
                ) : null}
                {selectedProvider && providerEndpoint ? (
                  <p className="text-xs text-muted-foreground">
                    Base URL 来自凭据库 endpoint「{providerEndpoint}」。
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    clearFieldErrors('apiKey');
                  }}
                  placeholder={
                    selectedProvider ? '密钥由凭据库提供' : isEdit ? '留空表示保持不变' : '必填'
                  }
                  disabled={selectedProvider !== null}
                  aria-invalid={fieldErrors.apiKey ? true : undefined}
                  aria-describedby={fieldErrors.apiKey ? 'profile-api-key-error' : undefined}
                />
                {fieldErrors.apiKey ? (
                  <p id="profile-api-key-error" className="text-xs text-destructive">
                    {fieldErrors.apiKey}
                  </p>
                ) : null}
                {selectedProvider ? (
                  <p className="text-xs text-muted-foreground">
                    已引用共享 Provider，密钥在「凭据库」中统一轮换。
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">
                  {harness.id === 'claude' ? '回退模型（ANTHROPIC_MODEL）' : '模型'}
                </Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    clearFieldErrors('model');
                  }}
                  placeholder={
                    harness.id === 'claude'
                      ? '可选；各档未匹配时使用，例如 glm-5'
                      : '例如：claude-sonnet-4-5'
                  }
                  aria-invalid={fieldErrors.model ? true : undefined}
                  aria-describedby={fieldErrors.model ? 'profile-model-error' : undefined}
                />
                {fieldErrors.model ? (
                  <p id="profile-model-error" className="text-xs text-destructive">
                    {fieldErrors.model}
                  </p>
                ) : null}
                {harness.id === 'claude' ? (
                  <p className="text-xs text-muted-foreground">
                    留空则沿用 Claude Code 默认模型；可在下面分别映射各模型档位。
                  </p>
                ) : null}
              </div>

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
                <Label htmlFor="notes">备注（可选）</Label>
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
                高级：原始配置
                {profile && profile.overriddenTargets.length > 0 ? (
                  <Badge variant="secondary">已手动接管</Badge>
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
                    <p className="text-sm text-muted-foreground">
                      先保存这份配置，之后回到编辑界面即可接管原始文件内容。
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter className="shrink-0 border-t bg-card px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存配置'}
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
  if (targets === null) {
    return <p className="text-sm text-muted-foreground">正在读取将写入的内容…</p>;
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">
        下面是当前会写入磁盘的内容，基于最近一次保存的字段生成。改动任意一份即视为手动接管，之后
        表单字段不再影响这份文件。
      </p>
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
                  恢复为自动生成
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
  const presets = PRESETS[harnessId] ?? [];
  if (presets.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">快速填充：</span>
      {presets.map((preset) => (
        <Button
          key={preset.label}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPick(preset)}
        >
          {preset.label}
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
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `extra-${field.key}`;
  return (
    <div
      className={
        field.kind === 'textarea' || field.fullWidth ? 'space-y-2 sm:col-span-2' : 'space-y-2'
      }
    >
      <Label htmlFor={id}>{field.label}</Label>
      {field.kind === 'select' ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-label={field.label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          >
            <SelectValue placeholder={field.placeholder ?? '请选择'} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === 'textarea' ? (
        <Textarea
          id={id}
          rows={3}
          value={value}
          placeholder={field.placeholder}
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
          placeholder={field.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
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
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const subagentField = fieldByKey.get(CLAUDE_SUBAGENT_ROW.modelKey);

  return (
    <section
      data-slot="claude-model-mapping"
      className="space-y-4 rounded-xl border bg-muted/15 p-4 sm:col-span-2 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold">模型映射</h3>
        <p className="text-sm text-muted-foreground">
          显示名称仅影响 Claude Code 的 /model 菜单；留空时显示对应的实际模型 ID。开启「1M
          上下文」会在模型 ID 末尾追加 [1m]，仅在该模型确实支持 1M 时开启。
        </p>
      </div>

      <div
        className={`hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid ${CLAUDE_MAPPING_COLUMNS}`}
      >
        <span>模型角色</span>
        <span>显示名称</span>
        <span>实际请求模型</span>
        <span>1M 上下文</span>
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
                  {nameField.label}
                </Label>
                <Input
                  id={`extra-${nameKey}`}
                  value={values[nameKey] ?? ''}
                  placeholder={
                    values[modelKey]?.trim()
                      ? `默认：${values[modelKey].trim()}`
                      : nameField.placeholder
                  }
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? `extra-${nameKey}-error` : undefined}
                  onChange={(event) => onChange(nameKey, event.target.value)}
                />
                {nameError ? (
                  <p id={`extra-${nameKey}-error`} className="text-xs text-destructive">
                    {nameError}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`extra-${modelKey}`} className="text-xs md:sr-only">
                  {modelField.label}
                </Label>
                <Input
                  id={`extra-${modelKey}`}
                  value={values[modelKey] ?? ''}
                  placeholder={modelField.placeholder}
                  aria-invalid={modelError ? true : undefined}
                  aria-describedby={modelError ? `extra-${modelKey}-error` : undefined}
                  onChange={(event) => onChange(modelKey, event.target.value)}
                />
                {modelError ? (
                  <p id={`extra-${modelKey}-error`} className="text-xs text-destructive">
                    {modelError}
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
              不显示在 /model 菜单
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="extra-subagentModel" className="text-xs md:sr-only">
                {subagentField.label}
              </Label>
              <Input
                id="extra-subagentModel"
                value={values.subagentModel ?? ''}
                placeholder={subagentField.placeholder}
                aria-invalid={errors['extra:subagentModel'] ? true : undefined}
                aria-describedby={
                  errors['extra:subagentModel'] ? 'extra-subagentModel-error' : undefined
                }
                onChange={(event) => onChange('subagentModel', event.target.value)}
              />
              {errors['extra:subagentModel'] ? (
                <p id="extra-subagentModel-error" className="text-xs text-destructive">
                  {errors['extra:subagentModel']}
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
  error?: string;
  onChange: (key: string, value: string) => void;
}) {
  if (!field) {
    return (
      <div
        data-slot="one-m-unsupported"
        className="flex h-10 items-center rounded-lg border border-dashed bg-muted/20 px-3 text-sm text-muted-foreground"
      >
        {role} 不支持 1M
      </div>
    );
  }
  const id = `extra-${field.key}`;
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
            aria-label={field.label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onCheckedChange={(checked) => onChange(field.key, checked === true ? 'true' : 'false')}
          />
          <span className="md:hidden">{field.label}</span>
          <span className="hidden md:inline">启用</span>
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
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
