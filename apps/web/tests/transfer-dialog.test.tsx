import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransferDialog } from '@/components/transfer-dialog';
import { useAppStore } from '@/stores/app-store';

const envelope = {
  format: 'harness-switch-encrypted-export' as const,
  version: 1 as const,
  kdf: { name: 'scrypt' as const, salt: 'salt' },
  cipher: { name: 'aes-256-gcm' as const, iv: 'iv', tag: 'tag', data: 'data' },
};

const realFetch = globalThis.fetch;
const realCreateObjectUrl = URL.createObjectURL;
const realRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  useAppStore.setState({ loadHarnesses: async () => {} });
  URL.createObjectURL = () => 'blob:transfer';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  URL.createObjectURL = realCreateObjectUrl;
  URL.revokeObjectURL = realRevokeObjectUrl;
});

test('exports all profiles only after the migration password is confirmed', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<TransferDialog open onOpenChange={() => {}} />);
  const download = screen.getByRole('button', { name: /下载加密导出包/ });
  expect(download).toBeDisabled();

  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#export-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.change(screen.getByLabelText('确认迁移密码'), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(download);

  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.path).toBe('/api/transfer/export');
  expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ passphrase: 'portable-secret' });
  expect(await screen.findByText(/加密导出包已生成/)).toBeInTheDocument();
});

test('previews file contents and conflicts before enabling import', async () => {
  globalThis.fetch = (async (path: string) => {
    expect(path).toBe('/api/transfer/preview');
    return new Response(
      JSON.stringify({
        exportedAt: '2026-08-18T00:00:00.000Z',
        profileCount: 2,
        harnesses: [{ harness: 'claude', profiles: 2 }],
        conflicts: [{ harness: 'claude', name: 'main' }],
        activeCount: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;

  render(<TransferDialog open onOpenChange={() => {}} />);
  const file = new File(['ignored'], 'portable.hsw-backup', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(envelope) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  expect(await screen.findByText('portable.hsw-backup')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  const inspect = screen.getByRole('button', { name: '检查导入内容' });
  await waitFor(() => expect(inspect).toBeEnabled());
  fireEvent.click(inspect);

  expect(await screen.findByText('2 个配置')).toBeInTheDocument();
  expect(screen.getByText('1 个同名冲突')).toBeInTheDocument();
  expect(screen.getByText(/Claude Code \/ main/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认导入' })).toBeInTheDocument();
});
