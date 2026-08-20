import { expect, test } from '@rstest/core';
import type { PreviewTarget } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileDialog } from '@/components/profile-dialog';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture, stubStoreActions } from './fixtures';

type Recorded = { created: unknown[][]; updated: unknown[][] };

function setup(preview: PreviewTarget[] = []): Recorded {
  const recorded: Recorded = { created: [], updated: [] };
  useAppStore.setState({
    providers: [],
    createProfile: async (...args: unknown[]) => {
      recorded.created.push(args);
    },
    updateProfile: async (...args: unknown[]) => {
      recorded.updated.push(args);
    },
    previewProfile: async () => preview,
    loadProviders: async () => {},
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return recorded;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('renders the harness specific fields the server described', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const select = screen.getByRole('combobox', { name: '凭据变量' });
  // The form is driven by the server's field specs, so the schema lives in one place.
  expect(select).toHaveTextContent('ANTHROPIC_AUTH_TOKEN');
  fireEvent.pointerDown(select, { button: 0, pointerType: 'mouse' });
  expect(screen.getByRole('option', { name: /^ANTHROPIC_AUTH_TOKEN/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^ANTHROPIC_API_KEY/ })).toBeInTheDocument();
  expect(screen.getByText(/settings\.json/)).toBeInTheDocument();
});

test('selecting an option updates the controlled extra field', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const select = screen.getByRole('combobox', { name: '凭据变量' });
  fireEvent.pointerDown(select, { button: 0, pointerType: 'mouse' });
  fireEvent.click(screen.getByRole('option', { name: /^ANTHROPIC_API_KEY/ }));

  fill('配置名称', 'component-select');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-test');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  expect(recorded.created[0]?.[1]).toMatchObject({
    extras: { authVar: 'ANTHROPIC_API_KEY' },
  });
});

test('marks core fields invalid and clears each error when the value changes', () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  expect(screen.getByLabelText('配置名称')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('API Base URL')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('API Key')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('请输入配置名称')).toBeInTheDocument();
  expect(screen.getByText('请输入 API Base URL')).toBeInTheDocument();
  expect(screen.getByText('请输入 API Key')).toBeInTheDocument();
  expect(recorded.created).toEqual([]);

  fill('配置名称', 'valid-name');
  expect(screen.getByLabelText('配置名称').getAttribute('aria-invalid')).toBeNull();
  expect(screen.getByLabelText('API Base URL')).toHaveAttribute('aria-invalid', 'true');
});

test('validates the adapter model and required dynamic fields consistently', () => {
  const recorded = setup();
  render(
    <ProfileDialog
      harness={harnessFixture({
        id: 'kimi',
        label: 'Kimi Code',
        modelRequired: true,
        fields: [
          { key: 'region', label: '区域', kind: 'select', required: true, options: [] },
          { key: 'headers', label: '请求头', kind: 'textarea', required: true },
        ],
      })}
      profile={null}
      onOpenChange={() => {}}
    />,
  );

  fill('配置名称', 'kimi-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-test');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  expect(screen.getByLabelText('模型')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('combobox', { name: '区域' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('请求头')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('请输入模型名称')).toBeInTheDocument();
  expect(screen.getByText('请填写区域')).toBeInTheDocument();
  expect(screen.getByText('请填写请求头')).toBeInTheDocument();
  expect(recorded.created).toEqual([]);
});

test('creating submits the core fields together with the field defaults', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  fill('配置名称', 'openrouter-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-test');
  fill('回退模型（ANTHROPIC_MODEL）', 'claude-sonnet-4-5');
  fill('Haiku 模型映射', 'claude-haiku-4-5');
  fill('Haiku 显示名称（选填）', 'Fast');
  fill('Sonnet 模型映射', 'claude-sonnet-4-5');
  fill('Sonnet 显示名称（选填）', 'Balanced');
  fill('Opus 模型映射', 'claude-opus-4-5');
  fill('Opus 显示名称（选填）', 'Powerful');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  expect(recorded.created[0]).toEqual([
    'claude',
    {
      name: 'openrouter-main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
      notes: '',
      extras: {
        authVar: 'ANTHROPIC_AUTH_TOKEN',
        haikuModel: 'claude-haiku-4-5',
        haikuModelName: 'Fast',
        sonnetModel: 'claude-sonnet-4-5',
        sonnetModelName: 'Balanced',
        sonnetModel1m: 'false',
        opusModel: 'claude-opus-4-5',
        opusModelName: 'Powerful',
        opusModel1m: 'false',
        fableModel: '',
        fableModelName: '',
        fableModel1m: 'false',
        subagentModel: '',
        subagentModel1m: 'false',
      },
    },
  ]);
});

test('a preset fills the base url and the model in one click', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'Z.AI（Anthropic 兼容）' }));

  expect(screen.getByLabelText('API Base URL')).toHaveValue('https://api.z.ai/api/anthropic');
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）')).toHaveValue('glm-4.6');
});

test('keeps the title and close action outside the scroll area and puts Provider first', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const heading = screen.getByRole('heading', { name: '新增 Claude Code 配置' });
  const content = heading.closest('[data-slot="dialog-content"]');
  const scroll = content?.querySelector('[data-slot="profile-dialog-scroll"]');
  const provider = content?.querySelector('[data-slot="provider-reference-fields"]');
  const close = screen.getByRole('button', { name: 'Close' });

  expect(content).toHaveClass('overflow-hidden');
  expect(content).toHaveClass('sm:max-w-[1120px]');
  expect(scroll).toHaveClass('overflow-y-auto');
  expect(scroll?.contains(heading)).toBe(false);
  expect(scroll?.contains(close)).toBe(false);
  expect(scroll?.firstElementChild).toBe(provider);
});

test('groups Claude model mappings into a wide role, display name, model and 1M grid', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const mapping = screen.getByText('模型映射').closest('[data-slot="claude-model-mapping"]');
  expect(mapping).toBeInTheDocument();
  expect(mapping).toHaveTextContent('模型角色');
  expect(mapping).toHaveTextContent('显示名称');
  expect(mapping).toHaveTextContent('实际请求模型');
  expect(mapping).toHaveTextContent('1M 上下文');
  expect(mapping).toHaveTextContent('Sonnet');
  expect(mapping).toHaveTextContent('Opus');
  expect(mapping).toHaveTextContent('Fable');
  expect(mapping).toHaveTextContent('Haiku');
  expect(mapping).toHaveTextContent('Subagent');

  fill('Sonnet 模型映射', 'gpt-5.6-terra');
  expect(screen.getByLabelText('Sonnet 显示名称（选填）')).toHaveAttribute(
    'placeholder',
    '默认：gpt-5.6-terra',
  );
});

test('puts every 1M checkbox in the mapping grid beside the tier it belongs to', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const mapping = screen.getByText('模型映射').closest('[data-slot="claude-model-mapping"]');

  for (const [role, modelLabel, oneMLabel] of [
    ['Sonnet', 'Sonnet 模型映射', 'Sonnet 声明支持 1M'],
    ['Opus', 'Opus 模型映射', 'Opus 声明支持 1M'],
    ['Fable', 'Fable 模型映射（可选）', 'Fable 声明支持 1M'],
    ['Subagent', '子代理模型（可选）', '子代理 声明支持 1M'],
  ]) {
    const toggle = screen.getByRole('checkbox', { name: oneMLabel });
    expect(toggle).toHaveAttribute('data-slot', 'checkbox');
    expect(mapping?.contains(toggle)).toBe(true);
    // Same row as its own model input, which is what "one line per tier" means here.
    const row = screen.getByLabelText(modelLabel).closest('.grid');
    expect(row?.contains(toggle)).toBe(true);
    // The FieldSpec default of 'false' must read as unchecked, not as indeterminate.
    expect(toggle).toHaveAttribute('data-state', 'unchecked');
    expect(row).toHaveTextContent(role);
  }
});

test('Haiku states it has no 1M variant instead of offering a checkbox', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  expect(screen.queryByRole('checkbox', { name: /Haiku 声明支持 1M/ })).toBeNull();
  const row = screen.getByLabelText('Haiku 模型映射').closest('.grid');
  expect(row?.querySelector('[role="checkbox"]')).toBeNull();
  expect(row).toHaveTextContent('Haiku 不支持 1M');
});

test('does not repeat the 1M fields as generic fields outside the mapping grid', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const mapping = screen.getByText('模型映射').closest('[data-slot="claude-model-mapping"]');
  for (const label of [
    'Sonnet 声明支持 1M',
    'Opus 声明支持 1M',
    'Fable 声明支持 1M',
    '子代理 声明支持 1M',
  ]) {
    // A duplicate render outside the section would make this an ambiguous-match throw.
    const toggles = screen.getAllByRole('checkbox', { name: label });
    expect(toggles).toHaveLength(1);
    expect(mapping?.contains(toggles[0])).toBe(true);
  }
  // The old select-based control must be gone entirely.
  expect(screen.queryByRole('combobox', { name: /声明支持 1M/ })).toBeNull();
});

test('checking a 1M box submits the string the adapter reads', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  fill('配置名称', 'one-m-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-test');
  fill('Sonnet 模型映射', 'gateway-sonnet');
  fill('Opus 模型映射', 'gateway-opus');

  const sonnet = screen.getByRole('checkbox', { name: 'Sonnet 声明支持 1M' });
  fireEvent.click(sonnet);
  expect(sonnet).toHaveAttribute('data-state', 'checked');

  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  expect(recorded.created[0]?.[1]).toMatchObject({
    extras: {
      sonnetModel: 'gateway-sonnet',
      // A checked box must serialise to 'true', not to boolean true or 'on'.
      sonnetModel1m: 'true',
      // Untouched tiers still submit the FieldSpec default rather than an empty string.
      opusModel: 'gateway-opus',
      opusModel1m: 'false',
      fableModel1m: 'false',
      subagentModel1m: 'false',
    },
  });
});

test('unchecking a stored 1M flag turns it back off', async () => {
  const recorded = setup();
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({ extras: { sonnetModel: 'gateway-sonnet', sonnetModel1m: 'true' } })}
      onOpenChange={() => {}}
    />,
  );

  const sonnet = screen.getByRole('checkbox', { name: 'Sonnet 声明支持 1M' });
  expect(sonnet).toHaveAttribute('data-state', 'checked');

  fireEvent.click(sonnet);
  expect(sonnet).toHaveAttribute('data-state', 'unchecked');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  expect(recorded.updated[0]?.[2]).toMatchObject({
    extras: { sonnetModel1m: 'false' },
  });
});

test('editing can rename the profile and keeps the stored key when left blank', async () => {
  const recorded = setup();
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({ notes: 'a note', extras: { authVar: 'ANTHROPIC_API_KEY' } })}
      onOpenChange={() => {}}
    />,
  );

  expect(screen.getByLabelText('配置名称')).toHaveValue('openrouter-main');
  expect(screen.getByLabelText('API Base URL')).toHaveValue('https://api.example.com/v1');
  expect(screen.getByRole('combobox', { name: '凭据变量' })).toHaveTextContent('ANTHROPIC_API_KEY');
  expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '留空表示保持不变');

  fill('配置名称', 'renamed-main');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(recorded.updated).toHaveLength(1));

  const [, name, payload] = recorded.updated[0] as [string, string, { apiKey?: string }];
  expect(name).toBe('openrouter-main');
  expect(payload).toMatchObject({ name: 'renamed-main' });
  // An empty field must not blank out the stored secret.
  expect(payload.apiKey).toBeUndefined();
});

test('the raw editor is only offered once the profile exists', () => {
  setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  const trigger = screen.getByRole('button', { name: /高级：原始配置/ });
  expect(trigger).toHaveClass('rounded-xl');
  fireEvent.click(trigger);
  expect(trigger).toHaveClass('rounded-t-xl');
  expect(screen.getByText(/先保存这份配置/)).toBeInTheDocument();
});

test('editing the raw content takes the file over and submits it verbatim', async () => {
  const recorded = setup([
    {
      key: 'settings',
      label: 'settings.json',
      path: '/home/tester/.claude/settings.json',
      format: 'json',
      content: '{\n  "env": {}\n}\n',
      overridden: false,
      currentContent: null,
    },
  ]);
  render(
    <ProfileDialog harness={harnessFixture()} profile={profileFixture()} onOpenChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole('button', { name: /高级：原始配置/ }));
  const editor = await screen.findByLabelText('/home/tester/.claude/settings.json');
  expect(editor).toHaveValue('{\n  "env": {}\n}\n');

  fireEvent.change(editor, { target: { value: '{"env":{"HAND":"1"}}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  const [, , payload] = recorded.updated[0] as [
    string,
    string,
    { overrides: Record<string, string> },
  ];
  expect(payload.overrides).toEqual({ settings: '{"env":{"HAND":"1"}}' });
});

test('handing a file back clears its override', async () => {
  const recorded = setup([
    {
      key: 'settings',
      label: 'settings.json',
      path: '/home/tester/.claude/settings.json',
      format: 'json',
      content: '{"env":{"HAND":"1"}}',
      overridden: true,
      currentContent: null,
    },
  ]);
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({ overriddenTargets: ['settings'] })}
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /高级：原始配置/ }));
  const reset = await screen.findByRole('button', { name: /恢复为自动生成/ });
  fireEvent.click(reset);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  const [, , payload] = recorded.updated[0] as [
    string,
    string,
    { overrides: Record<string, string> },
  ];
  // An empty map is what tells the server to go back to generating the file.
  expect(payload.overrides).toEqual({});
});

test('shows the reason a save failed instead of closing silently', async () => {
  useAppStore.setState({
    providers: [],
    createProfile: async () => {
      throw new Error('profile already exists');
    },
    loadProviders: async () => {},
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  const closes: boolean[] = [];
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={null}
      onOpenChange={(open) => closes.push(open)}
    />,
  );

  fill('配置名称', 'openrouter-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-test');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  expect(await screen.findByText('profile already exists')).toBeInTheDocument();
  expect(closes).toEqual([]);
});

test('explains that an additive harness keeps the providers written by hand', () => {
  setup();
  render(
    <ProfileDialog
      harness={harnessFixture({ id: 'kimi', label: 'Kimi Code', mode: 'additive', fields: [] })}
      profile={null}
      onOpenChange={() => {}}
    />,
  );

  expect(screen.getByText(/不会删除你手写的其他 provider/)).toBeInTheDocument();
});

test('stubStoreActions keeps the dialog from reaching the network', () => {
  const calls = stubStoreActions(['createProfile']);
  expect(calls.createProfile).toEqual([]);
});
