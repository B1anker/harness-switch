import { expect, test } from '@rstest/core';
import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileDialog } from '@/components/profile-dialog';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture, providerFixture } from './fixtures';

/**
 * The probe is a pure UI conversation with three store actions; stubbing them lets
 * these tests assert exactly what the dialogs ask for and how each outcome renders,
 * without a server. The service- and API-level behaviour lives in the server tests.
 */

const OK_RESULT: ProbeResult = {
  ok: true,
  status: 200,
  latencyMs: 42,
  requestUrl: 'https://api.example.com/v1/models',
  models: ['model-a', 'model-b'],
};

function setupProfileDialog(
  overrides: { draft?: ProbeResult | Error; saved?: ProbeResult | Error } = {},
) {
  const calls = { draft: [] as unknown[][], saved: [] as unknown[][] };
  useAppStore.setState({
    providers: [],
    loadProviders: async () => {},
    probeDraft: async (...args: unknown[]) => {
      calls.draft.push(args);
      if (overrides.draft instanceof Error) throw overrides.draft;
      return overrides.draft ?? OK_RESULT;
    },
    probeProfile: async (...args: unknown[]) => {
      calls.saved.push(args);
      if (overrides.saved instanceof Error) throw overrides.saved;
      return overrides.saved ?? OK_RESULT;
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return calls;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function renderCreateDialog() {
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);
}

test('the profile dialog probes a typed key without saving it first', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('配置名称', 'p-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.draft).toHaveLength(1));
  expect(calls.saved).toEqual([]);
  expect(calls.draft[0]?.[0]).toEqual({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-typed',
  });
});

test('a successful probe reports latency and model count', async () => {
  setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  expect(await screen.findByText('连接正常 · 42ms · 2 个模型')).toBeInTheDocument();
});

test('a successful probe feeds the model field a datalist to pick from', async () => {
  setupProfileDialog();
  renderCreateDialog();

  const model = screen.getByLabelText('回退模型（ANTHROPIC_MODEL）') as HTMLInputElement;
  // No catalog yet, so the input carries no list binding.
  expect(model.getAttribute('list')).toBeNull();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await screen.findByText(/连接正常/);
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）').getAttribute('list')).toBe(
    'profile-model-options',
  );
  const options = document.querySelectorAll('#profile-model-options option');
  expect(Array.from(options).map((option) => option.getAttribute('value'))).toEqual([
    'model-a',
    'model-b',
  ]);
});

test('a failed probe renders the translated reason instead of throwing', async () => {
  setupProfileDialog({
    draft: {
      ok: false,
      code: 'probe.unauthorized',
      params: { status: 401 },
      message: '端点可达但拒绝了凭据（HTTP 401），请检查 API Key',
    },
  });
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-wrong');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  expect(
    await screen.findByText('端点可达但拒绝了凭据（HTTP 401），请检查 API Key'),
  ).toBeInTheDocument();
  // The failure must not leave a stale catalog bound to the input.
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）').getAttribute('list')).toBeNull();
});

test('editing a saved profile without retyping the key probes stored credentials', async () => {
  const calls = setupProfileDialog();
  render(
    <ProfileDialog harness={harnessFixture()} profile={profileFixture()} onOpenChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.saved).toHaveLength(1));
  expect(calls.saved[0]).toEqual(['claude', 'openrouter-main']);
  expect(calls.draft).toEqual([]);
});

test('a vault-referenced profile resolves its key through providerId, not inline text', async () => {
  const calls = setupProfileDialog();
  useAppStore.setState({ providers: [providerFixture()] });
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({ providerId: 'openrouter', providerEndpoint: 'main' })}
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.draft).toHaveLength(1));
  // The base URL comes from the named endpoint; the key stays in the vault.
  expect(calls.draft[0]?.[0]).toMatchObject({
    baseUrl: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
  });
});

test('creating without any key points at the API Key field instead of firing a request', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  expect(calls.draft).toEqual([]);
  expect(calls.saved).toEqual([]);
  expect(await screen.findByText('请输入 API Key')).toBeInTheDocument();
});

test('a missing base URL marks that field instead of probing', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  expect(calls.draft).toEqual([]);
  expect(screen.getByLabelText('API Base URL')).toHaveAttribute('aria-invalid', 'true');
});

test('editing any relevant input invalidates a previous probe result', async () => {
  setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await screen.findByText(/连接正常/);

  fill('API Base URL', 'https://other.example.com/v1');
  expect(screen.queryByText(/连接正常/)).toBeNull();
  // And the stale catalog no longer drives the model input.
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）').getAttribute('list')).toBeNull();
});

/* ------------------------------------------------------------------ */
/* Provider Vault editor                                               */
/* ------------------------------------------------------------------ */

type VaultCalls = { drafts: unknown[][] };

function setupVaultDialog(): VaultCalls {
  const calls: VaultCalls = { drafts: [] };
  useAppStore.setState({
    providers: [providerFixture()],
    providersLoading: false,
    providersError: null,
    loadProviders: async () => {},
    createProvider: async () => {},
    updateProvider: async () => ({ provider: providerFixture(), warnings: [] }),
    deleteProvider: async () => {},
    revealProvider: async () => ({ apiKey: 'sk-secret' }),
    probeDraft: async (...args: unknown[]) => {
      calls.drafts.push(args);
      return OK_RESULT;
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return calls;
}

function openEditForm() {
  render(<ProviderVaultDialog open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑 OpenRouter' }));
}

test('the vault editor probes the stored credential against the entry endpoint', async () => {
  const calls = setupVaultDialog();
  openEditForm();

  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.drafts).toHaveLength(1));
  expect(calls.drafts[0]?.[0]).toEqual({
    baseUrl: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
  });
  expect(await screen.findByText(/连接正常/)).toBeInTheDocument();
});

test('a freshly typed key is tested as a draft instead of the stored one', async () => {
  const calls = setupVaultDialog();
  openEditForm();

  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-rotated' } });
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.drafts).toHaveLength(1));
  expect(calls.drafts[0]?.[0]).toEqual({
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-rotated',
  });
});

test('with several endpoints drafted, the selector picks which URL gets tested', async () => {
  const calls = setupVaultDialog();
  openEditForm();

  const trigger = screen.getByRole('combobox', { name: '选择要测试的 endpoint' });
  expect(trigger).toHaveTextContent('main');
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.click(screen.getByRole('option', { name: 'fallback' }));
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

  await waitFor(() => expect(calls.drafts).toHaveLength(1));
  expect(calls.drafts[0]?.[0]).toMatchObject({
    baseUrl: 'https://fallback.example.com/v1',
    providerId: 'openrouter',
  });
});
