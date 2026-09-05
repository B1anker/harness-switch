import { expect, test } from '@rstest/core';
import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileDialog } from '@/components/profile-dialog';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { harnessFixture, profileFixture, providerFixture, setStoreState } from './support';

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
  setStoreState({
    providers: [],
    loadProviders: async () => {},
    probeDraft: async (...args: unknown[]) => {
      calls.draft.push(args);
      if (overrides.draft instanceof Error) {
        throw overrides.draft;
      }
      return overrides.draft ?? OK_RESULT;
    },
    probeProfile: async (...args: unknown[]) => {
      calls.saved.push(args);
      if (overrides.saved instanceof Error) {
        throw overrides.saved;
      }
      return overrides.saved ?? OK_RESULT;
    },
  });
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
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

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
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  expect(await screen.findByText('连接正常 · 42ms · 2 个模型')).toBeInTheDocument();
});

test('a successful catalog request turns the model input into a shadcn select', async () => {
  setupProfileDialog();
  renderCreateDialog();

  const model = screen.getByLabelText('回退模型（ANTHROPIC_MODEL）') as HTMLInputElement;
  expect(model).toBeInTheDocument();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  await screen.findByText(/连接正常/);
  const select = screen.getByLabelText('模型');
  expect(select).toHaveAttribute('data-slot', 'select-trigger');
  fireEvent.click(select);
  expect(await screen.findByRole('option', { name: 'model-a' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'model-b' })).toBeInTheDocument();
});

test('a successful catalog request also turns Claude model mappings into selects', async () => {
  setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  await screen.findByText(/连接正常/);
  const sonnet = screen.getByRole('combobox', { name: 'Sonnet 模型映射' });
  expect(sonnet).toHaveAttribute('data-slot', 'select-trigger');
  fireEvent.click(sonnet);
  fireEvent.click(await screen.findByRole('option', { name: 'model-b' }));
  expect(sonnet).toHaveTextContent('model-b');
});

test('a failed probe renders the translated reason instead of throwing', async () => {
  setupProfileDialog({
    draft: {
      ok: false,
      code: 'probe.unauthorized',
      data: { status: 401 },
    },
  });
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-wrong');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  expect(
    await screen.findByText('端点可达但拒绝了凭据（HTTP 401），请检查 API Key'),
  ).toBeInTheDocument();
  // The failure must not leave a stale catalog bound to the input.
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）')).toBeInstanceOf(HTMLInputElement);
});

test('editing a saved profile without retyping the key probes stored credentials', async () => {
  const calls = setupProfileDialog();
  render(
    <ProfileDialog harness={harnessFixture()} profile={profileFixture()} onOpenChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  await waitFor(() => expect(calls.saved).toHaveLength(1));
  // No options at all, so the server's own defaults apply and no completion is sent.
  expect(calls.saved[0]).toEqual(['claude', 'openrouter-main', undefined]);
  expect(calls.draft).toEqual([]);
});

test('a vault-referenced profile resolves its key through providerId, not inline text', async () => {
  const calls = setupProfileDialog();
  setStoreState({ providers: [providerFixture()] });
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({ providerId: 'openrouter', providerEndpoint: 'main' })}
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

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
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  expect(calls.draft).toEqual([]);
  expect(calls.saved).toEqual([]);
  expect(await screen.findByText('请输入 API Key')).toBeInTheDocument();
});

test('a missing base URL marks that field instead of probing', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  expect(calls.draft).toEqual([]);
  expect(screen.getByLabelText('API Base URL')).toHaveAttribute('aria-invalid', 'true');
});

test('editing any relevant input invalidates a previous probe result', async () => {
  setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));
  await screen.findByText(/连接正常/);

  fill('API Base URL', 'https://other.example.com/v1');
  expect(screen.queryByText(/连接正常/)).toBeNull();
  // And the stale catalog no longer drives the model input.
  expect(screen.getByLabelText('回退模型（ANTHROPIC_MODEL）')).toBeInstanceOf(HTMLInputElement);
});

/* ------------------------------------------------------------------ */
/* Completion probe                                                    */
/* ------------------------------------------------------------------ */

test('the fetch-models button does not request a completion', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

  await waitFor(() => expect(calls.draft).toHaveLength(1));
  // A token is only ever spent on an explicit ask.
  expect(calls.draft[0]?.[0]).toEqual({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-typed',
  });
});

test('the completion button asks for a completion against the typed model', async () => {
  const calls = setupProfileDialog();
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fill('回退模型（ANTHROPIC_MODEL）', 'model-a');
  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  await waitFor(() => expect(calls.draft).toHaveLength(1));
  expect(calls.draft[0]?.[0]).toEqual({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-typed',
    completion: true,
    model: 'model-a',
  });
});

test('a saved-profile completion asks to bypass any cached verdict', async () => {
  const calls = setupProfileDialog();
  render(
    <ProfileDialog harness={harnessFixture()} profile={profileFixture()} onOpenChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  await waitFor(() => expect(calls.saved).toHaveLength(1));
  // Clicking the button means "test it now", so a stored outcome must not be replayed.
  expect(calls.saved[0]?.[2]).toMatchObject({ completion: true, refresh: true });
});

test('a listed model that does not answer renders red under a green catalog line', async () => {
  setupProfileDialog({
    draft: {
      ...OK_RESULT,
      completion: {
        ok: false,
        model: 'model-a',
        status: 500,
        code: 'probe.completionHttpError',
        data: { status: 500, model: 'model-a' },
      },
    },
  });
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  // Both verdicts are shown: the endpoint is reachable and the model still cannot serve.
  expect(await screen.findByText('连接正常 · 42ms · 2 个模型')).toBeInTheDocument();
  expect(
    await screen.findByText('模型 model-a 的补全请求返回 HTTP 500：目录里有这个模型，但它无法作答'),
  ).toBeInTheDocument();
});

test('a working model reports its own success line', async () => {
  setupProfileDialog({
    draft: {
      ...OK_RESULT,
      completion: { ok: true, model: 'model-a', latencyMs: 640, produced: true },
    },
  });
  renderCreateDialog();

  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  expect(await screen.findByText('模型 model-a 可作答 · 640ms')).toBeInTheDocument();
});

test('a replayed outcome says when it was measured rather than claiming it is current', async () => {
  setupProfileDialog({
    saved: {
      ...OK_RESULT,
      completion: {
        ok: true,
        model: 'model-a',
        latencyMs: 640,
        cachedAt: '2026-09-03T04:05:00.000Z',
      },
    },
  });
  render(
    <ProfileDialog harness={harnessFixture()} profile={profileFixture()} onOpenChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  // "answered" and "answered hours ago" are different claims; the line must not blur them.
  expect(await screen.findByText(/模型 model-a 可作答/)).toHaveTextContent(/缓存/);
});

/* ------------------------------------------------------------------ */
/* Provider Vault editor                                               */
/* ------------------------------------------------------------------ */

type VaultCalls = { drafts: unknown[][] };

function setupVaultDialog(): VaultCalls {
  const calls: VaultCalls = { drafts: [] };
  setStoreState({
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
  });
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

test('the vault completion button asks for a completion against the entry endpoint', async () => {
  const calls = setupVaultDialog();
  openEditForm();

  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));

  await waitFor(() => expect(calls.drafts).toHaveLength(1));
  expect(calls.drafts[0]?.[0]).toEqual({
    baseUrl: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
    completion: true,
  });
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

test('typing mappings stays editable until an explicit catalog fetch, and completion preserves the catalog', async () => {
  setupProfileDialog();
  renderCreateDialog();
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-typed');
  fill('Sonnet 模型映射', 'manual-id');
  expect(screen.getByRole('textbox', { name: 'Sonnet 模型映射' })).toHaveValue('manual-id');
  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));
  await screen.findByText(/连接正常/);
  expect(screen.getByRole('textbox', { name: 'Sonnet 模型映射' })).toHaveValue('manual-id');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));
  await screen.findByRole('combobox', { name: 'Sonnet 模型映射' });
  fireEvent.click(screen.getByRole('button', { name: '测试补全' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '测试补全' })).toBeEnabled());
  expect(screen.getByRole('combobox', { name: 'Sonnet 模型映射' })).toHaveTextContent('manual-id');
  fill('API Base URL', 'https://other.example.com');
  expect(screen.getByRole('textbox', { name: 'Sonnet 模型映射' })).toHaveValue('manual-id');
});
