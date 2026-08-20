import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileDialog } from '@/components/profile-dialog';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture, providerFixture } from './fixtures';

type Recorded = {
  created: unknown[][];
  updated: unknown[][];
};

function setup(overrides: Partial<Recorded> = {}): Recorded {
  const recorded: Recorded = { created: [], updated: [], ...overrides };
  useAppStore.setState({
    providers: [providerFixture()],
    providersLoading: false,
    providersError: null,
    loadProviders: async () => {},
    createProfile: async (...args: unknown[]) => {
      recorded.created.push(args);
    },
    updateProfile: async (...args: unknown[]) => {
      recorded.updated.push(args);
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return recorded;
}

function pickProvider(name: string) {
  fireEvent.pointerDown(screen.getByRole('combobox', { name: '使用共享 Provider' }), {
    button: 0,
    pointerType: 'mouse',
  });
  fireEvent.click(screen.getByRole('option', { name }));
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('selecting a provider automatically selects its first endpoint', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  pickProvider('OpenRouter');

  expect(screen.getByText('密钥由凭据库提供')).toBeInTheDocument();
  expect(screen.getByLabelText('API Key')).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '命名 Endpoint' })).toHaveTextContent('主入口');
  expect(screen.getByLabelText('API Base URL')).toHaveValue('https://openrouter.ai/api/v1');
  expect(screen.getByLabelText('API Base URL')).toBeDisabled();

  fill('配置名称', 'shared-main');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  const payload = recorded.created[0]?.[1] as Record<string, unknown>;
  expect(payload.providerId).toBe('openrouter');
  expect(payload.providerEndpoint).toBe('main');
  expect(payload.apiKey).toBeUndefined();
});

test('picking an endpoint fills and disables the base url with its value', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  pickProvider('OpenRouter');

  fireEvent.pointerDown(screen.getByRole('combobox', { name: '命名 Endpoint' }), {
    button: 0,
    pointerType: 'mouse',
  });
  fireEvent.click(screen.getByRole('option', { name: /fallback/ }));

  expect(screen.getByLabelText('API Base URL')).toHaveValue('https://fallback.example.com/v1');
  expect(screen.getByLabelText('API Base URL')).toBeDisabled();

  fill('配置名称', 'endpoint-main');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  const payload = recorded.created[0]?.[1] as Record<string, unknown>;
  expect(payload.providerId).toBe('openrouter');
  expect(payload.providerEndpoint).toBe('fallback');
  expect(payload.baseUrl).toBe('https://fallback.example.com/v1');
  expect(payload.apiKey).toBeUndefined();
});

test('without a provider the form keeps its original behavior', async () => {
  const recorded = setup();
  render(<ProfileDialog harness={harnessFixture()} profile={null} onOpenChange={() => {}} />);

  fill('配置名称', 'inline-main');
  fill('API Base URL', 'https://api.example.com/v1');
  fill('API Key', 'sk-inline');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.created).toHaveLength(1));
  const payload = recorded.created[0]?.[1] as Record<string, unknown>;
  expect(payload.providerId).toBeUndefined();
  expect(payload.apiKey).toBe('sk-inline');
});

test('editing a provider-backed profile detaches when the provider is deselected', async () => {
  const recorded = setup();
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({
        providerId: 'openrouter',
        providerEndpoint: 'main',
        baseUrl: 'https://openrouter.ai/api/v1',
      })}
      onOpenChange={() => {}}
    />,
  );

  expect(screen.getByRole('combobox', { name: '使用共享 Provider' })).toHaveTextContent(
    'OpenRouter',
  );
  expect(screen.getByLabelText('API Key')).toBeDisabled();

  pickProvider('不使用（本配置自带密钥）');
  expect(screen.getByLabelText('API Key')).toBeEnabled();

  fill('配置名称', 'detached-main');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(recorded.updated).toHaveLength(1));
  const [, , payload] = recorded.updated[0] as [string, string, Record<string, unknown>];
  expect(payload.providerId).toBe('');
  expect(payload.providerEndpoint).toBeUndefined();
});

test('marks a stale endpoint select as invalid instead of submitting it', async () => {
  const recorded = setup();
  render(
    <ProfileDialog
      harness={harnessFixture()}
      profile={profileFixture({
        providerId: 'openrouter',
        providerEndpoint: 'removed',
        baseUrl: 'https://old.example.com/v1',
      })}
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  const select = screen.getByRole('combobox', { name: '命名 Endpoint' });
  expect(await screen.findByText('引用的 Endpoint 已不存在，请重新选择')).toBeInTheDocument();
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(recorded.updated).toEqual([]);
});
