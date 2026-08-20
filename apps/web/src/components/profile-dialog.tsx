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

  const providerEntries = providers ?? [];
  const selectedProvider = providerEntries.find((entry) => entry.id === providerId) ?? null;
  const selectedEndpoint = selectedProvider?.endpoints.find(
    (endpoint) => endpoint.key === providerEndpoint,
  );

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
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

          <PresetRow
            harnessId={harness.id}
            onPick={(preset) => {
              setBaseUrl(preset.baseUrl);
              if (preset.model) {
                setModel(preset.model);
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
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：openrouter-main"
                required
              />
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
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                disabled={selectedProvider !== null && providerEndpoint !== ''}
                required
              />
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
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  selectedProvider ? '密钥由凭据库提供' : isEdit ? '留空表示保持不变' : '必填'
                }
                disabled={selectedProvider !== null}
                required={!isEdit && selectedProvider === null}
              />
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
                onChange={(event) => setModel(event.target.value)}
                placeholder={
                  harness.id === 'claude'
                    ? '可选；各档未匹配时使用，例如 glm-5'
                    : '例如：claude-sonnet-4-5'
                }
              />
              {harness.id === 'claude' ? (
                <p className="text-xs text-muted-foreground">
                  留空则沿用 Claude Code 默认模型；可在下面分别映射各模型档位。
                </p>
              ) : null}
            </div>

            {harness.fields.map((field) => (
              <ExtraField
                key={field.key}
                field={field}
                value={extras[field.key] ?? ''}
                onChange={(value) => setExtras((current) => ({ ...current, [field.key]: value }))}
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

          <div className="space-y-3 rounded-xl border p-3">
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
                setProviderEndpoint('');
              }}
            >
              <SelectTrigger id="provider-select" aria-label="使用共享 Provider">
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
            {providerEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                凭据库为空，可先在顶部「凭据库」中新增 Provider 条目。
              </p>
            ) : null}
            {selectedProvider ? (
              <div className="space-y-2">
                <Label htmlFor="provider-endpoint">命名 Endpoint（可选）</Label>
                <Select value={providerEndpoint} onValueChange={setProviderEndpoint}>
                  <SelectTrigger id="provider-endpoint" aria-label="命名 Endpoint">
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
                {selectedProvider.endpoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    该 Provider 没有命名 endpoint，将使用下方 Base URL。
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border">
            <button
              type="button"
              onClick={toggleAdvanced}
              className="flex w-full cursor-pointer items-center gap-2 rounded-t-xl px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
            >
              {advanced ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
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

          <DialogFooter>
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
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `extra-${field.key}`;
  return (
    <div className={field.kind === 'textarea' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={id}>{field.label}</Label>
      {field.kind === 'select' ? (
        <Select value={value} onValueChange={onChange} required={field.required}>
          <SelectTrigger id={id} aria-label={field.label}>
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
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={field.kind === 'password' ? 'password' : 'text'}
          value={value}
          placeholder={field.placeholder}
          required={field.required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
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
