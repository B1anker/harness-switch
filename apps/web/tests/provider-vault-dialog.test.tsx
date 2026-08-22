import { expect, test } from '@rstest/core';
import type { ProviderPublic } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/app-store';
import { providerFixture } from './fixtures';

type Recorded = {
  created: unknown[][];
  updated: unknown[][];
  deleted: string[];
  loads: number[];
  revealed: string[];
};

function setup(providers: ProviderPublic[]): Recorded {
  const recorded: Recorded = { created: [], updated: [], deleted: [], loads: [], revealed: [] };
  useAppStore.setState({
    providers,
    providersLoading: false,
    providersError: null,
    loadProviders: async () => {
      recorded.loads.push(1);
    },
    createProvider: async (...args: unknown[]) => {
      recorded.created.push(args);
    },
    updateProvider: async (...args: unknown[]) => {
      recorded.updated.push(args);
      return { provider: providers[0] ?? providerFixture(), warnings: [] };
    },
    deleteProvider: async (id: string) => {
      recorded.deleted.push(id);
    },
    revealProvider: async (id: string) => {
      recorded.revealed.push(id);
      return { apiKey: 'sk-secret' };
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return recorded;
}

function renderDialog() {
  render(<ProviderVaultDialog open onOpenChange={() => {}} />);
}

test('lists every entry with its metadata and never leaks a key', () => {
  setup([providerFixture()]);
  renderDialog();

  expect(screen.getByText('OpenRouter')).toBeInTheDocument();
  expect(screen.getByText('密钥已配置')).toBeInTheDocument();
  expect(screen.getByText('main')).toBeInTheDocument();
  expect(screen.getByText('https://openrouter.ai/api/v1')).toBeInTheDocument();
  expect(screen.queryByText(/sk-/)).toBeNull();
});

test('shows the empty state when the vault has no entries', () => {
  setup([]);
  renderDialog();

  expect(screen.getByText(/凭据库为空/)).toBeInTheDocument();
});

test('creating an entry submits name, key and endpoints', async () => {
  const recorded = setup([]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '新增凭据' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'DeepSeek' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-vault' } });
  fireEvent.click(screen.getByRole('button', { name: '添加 endpoint' }));
  fireEvent.change(screen.getByLabelText('Endpoint 1 名称'), { target: { value: 'main' } });
  fireEvent.change(screen.getByLabelText('Endpoint 1 Base URL'), {
    target: { value: 'https://api.deepseek.com/v1' },
  });
  fireEvent.click(screen.getByRole('button', { name: '新增凭据' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  expect(recorded.created[0]?.[0]).toEqual({
    name: 'DeepSeek',
    apiKey: 'sk-vault',
    notes: undefined,
    endpoints: [{ key: 'main', label: '', baseUrl: 'https://api.deepseek.com/v1' }],
  });
  expect(screen.getByText(/已新增 Provider 条目/)).toBeInTheDocument();
});

test('editing rotates the key and submits the entry id', async () => {
  const recorded = setup([providerFixture()]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-rotated' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  const [id, payload] = recorded.updated[0] as [string, { apiKey: string; name: string }];
  expect(id).toBe('openrouter');
  expect(payload.apiKey).toBe('sk-rotated');
  expect(payload.name).toBe('OpenRouter');
});

test('editing has one aligned cancel/save action row without a duplicate close action', () => {
  setup([providerFixture()]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));

  expect(screen.getByRole('heading', { name: '编辑 OpenRouter' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
  expect(screen.queryByRole('button', { name: '返回凭据库' })).toBeNull();
  const cancel = screen.getByRole('button', { name: '取消' });
  const save = screen.getByRole('button', { name: '保存修改' });
  expect(cancel.parentElement).toBe(save.parentElement);
  expect(cancel.parentElement).toHaveClass('flex-row');
});

test('editing persists newly added named endpoints', async () => {
  const recorded = setup([providerFixture({ endpoints: [] })]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));
  fireEvent.click(screen.getByRole('button', { name: '添加 endpoint' }));
  fireEvent.change(screen.getByLabelText('Endpoint 1 名称'), { target: { value: ' main ' } });
  fireEvent.change(screen.getByLabelText('Endpoint 1 Base URL'), {
    target: { value: ' https://api.example.com/v1 ' },
  });
  fireEvent.change(screen.getByLabelText('Endpoint 1 标签'), { target: { value: ' 主入口 ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  expect(recorded.updated[0]).toEqual([
    'openrouter',
    {
      name: 'OpenRouter',
      notes: undefined,
      endpoints: [{ key: 'main', label: '主入口', baseUrl: 'https://api.example.com/v1' }],
    },
  ]);
});

test('an incomplete endpoint is not silently discarded', async () => {
  const recorded = setup([providerFixture({ endpoints: [] })]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));
  fireEvent.click(screen.getByRole('button', { name: '添加 endpoint' }));
  fireEvent.change(screen.getByLabelText('Endpoint 1 名称'), { target: { value: 'main' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

  const baseUrl = screen.getByLabelText('Endpoint 1 Base URL');
  expect(await screen.findByText('请输入 Base URL')).toBeInTheDocument();
  expect(baseUrl).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Endpoint 1 名称').getAttribute('aria-invalid')).toBeNull();
  expect(recorded.updated).toEqual([]);
});

test('marks each invalid endpoint field and clears the state while correcting it', async () => {
  const recorded = setup([providerFixture({ endpoints: [] })]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));
  fireEvent.click(screen.getByRole('button', { name: '添加 endpoint' }));
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

  const key = screen.getByLabelText('Endpoint 1 名称');
  const baseUrl = screen.getByLabelText('Endpoint 1 Base URL');
  expect(await screen.findByText('请输入 Endpoint 标识')).toBeInTheDocument();
  expect(screen.getByText('请输入 Base URL')).toBeInTheDocument();
  expect(key).toHaveAttribute('aria-invalid', 'true');
  expect(baseUrl).toHaveAttribute('aria-invalid', 'true');

  fireEvent.change(key, { target: { value: 'default' } });
  expect(key.getAttribute('aria-invalid')).toBeNull();
  expect(baseUrl).toHaveAttribute('aria-invalid', 'true');
  expect(recorded.updated).toEqual([]);
});

test('deleting asks for confirmation first and deletes on confirm', async () => {
  const recorded = setup([providerFixture()]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '删除 OpenRouter' }));
  expect(recorded.deleted).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(recorded.deleted).toEqual(['openrouter']));
  expect(screen.getByText('已删除。')).toBeInTheDocument();
});

test('a referenced provider shows the 409 reason instead of deleting', async () => {
  useAppStore.setState({
    providers: [providerFixture()],
    deleteProvider: async () => {
      throw new ApiError(409, 'Provider 正被 2 个配置引用，请先移除这些引用再删除', {
        code: 'provider.inUse',
        params: { count: 2 },
      });
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '删除 OpenRouter' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));

  expect(await screen.findByText(/该凭据正被 2 个配置引用/)).toBeInTheDocument();
});

test('revealing toggles the plaintext key from the store action', async () => {
  const recorded = setup([providerFixture()]);
  renderDialog();

  expect(screen.queryByText('sk-secret')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '显示 OpenRouter 的密钥' }));
  expect(await screen.findByText('sk-secret')).toBeInTheDocument();
  expect(recorded.revealed).toEqual(['openrouter']);

  fireEvent.click(screen.getByRole('button', { name: '隐藏 OpenRouter 的密钥' }));
  expect(screen.queryByText('sk-secret')).toBeNull();
});
