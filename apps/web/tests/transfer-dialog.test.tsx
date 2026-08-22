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
  useAppStore.setState({ notice: null });
});

test('exports all profiles only after the migration password is confirmed', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/transfer/export/preview' ? { codexLoginCacheAvailable: false } : envelope;
    return new Response(JSON.stringify(body), {
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

  await waitFor(() =>
    expect(requests.some((request) => request.path === '/api/transfer/export')).toBe(true),
  );
  const request = requests.find((item) => item.path === '/api/transfer/export');
  expect(JSON.parse(request?.body ?? '{}')).toEqual({
    passphrase: 'portable-secret',
    includeCodexLoginCache: false,
  });
  expect(await screen.findByText(/加密导出包已生成/)).toBeInTheDocument();
});

test('requires an explicit export choice to include a Codex login cache', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/transfer/export/preview' ? { codexLoginCacheAvailable: true } : envelope;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<TransferDialog open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByLabelText(/在导出包中包含 Codex 官方登录缓存/));
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#export-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.change(screen.getByLabelText('确认迁移密码'), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: /下载加密导出包/ }));

  await waitFor(() =>
    expect(requests.some((request) => request.path === '/api/transfer/export')).toBe(true),
  );
  const request = requests.find((item) => item.path === '/api/transfer/export');
  expect(JSON.parse(request?.body ?? '{}')).toEqual({
    passphrase: 'portable-secret',
    includeCodexLoginCache: true,
  });
});

test('previews file contents and conflicts before enabling import', async () => {
  globalThis.fetch = (async (path: string) => {
    const body =
      path === '/api/transfer/export/preview'
        ? { codexLoginCacheAvailable: false }
        : {
            exportedAt: '2026-08-18T00:00:00.000Z',
            profileCount: 2,
            harnesses: [{ harness: 'claude', profiles: 2 }],
            conflicts: [{ harness: 'claude', name: 'main' }],
            activeCount: 1,
            conflictPolicy: 'skip',
            restoreActive: true,
            codexActivationAuthEffect: 'none',
            codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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

test('requires a separate import choice before writing a bundled Codex login cache', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/transfer/export/preview'
        ? { codexLoginCacheAvailable: false }
        : path === '/api/transfer/preview'
          ? {
              exportedAt: '2026-08-18T00:00:00.000Z',
              profileCount: 0,
              harnesses: [],
              conflicts: [],
              activeCount: 0,
              conflictPolicy: 'skip',
              restoreActive: true,
              codexActivationAuthEffect: 'none',
              codexLoginCache: { available: true, targetExists: true, migrationNeeded: true },
            }
          : {
              ok: true,
              imported: 0,
              overwritten: 0,
              skipped: 0,
              activeRestored: 0,
              codexLoginCacheMigrated: true,
              warnings: [],
            };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<TransferDialog open onOpenChange={() => {}} />);
  const file = new File(['ignored'], 'portable.hsw-backup', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(envelope) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  await screen.findByText('portable.hsw-backup');
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  await screen.findByText('迁移 Codex 官方登录缓存（auth.json）');
  fireEvent.click(screen.getByLabelText(/迁移 Codex 官方登录缓存/));
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  expect(
    await screen.findByText(/完整 Codex 官方登录缓存会覆盖本机缓存，并自动创建备份/),
  ).toBeInTheDocument();
  expect(requests.filter((request) => request.path === '/api/transfer/import')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: '安全导入' }));
  await waitFor(() =>
    expect(requests.some((request) => request.path === '/api/transfer/import')).toBe(true),
  );
  const request = requests.find((item) => item.path === '/api/transfer/import');
  expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ migrateCodexLoginCache: true });
});

test('re-checks activation effects before importing and requires final acknowledgement', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const request = JSON.parse(String(init.body ?? '{}')) as {
      conflictPolicy?: 'skip' | 'overwrite';
      restoreActive?: boolean;
    };
    const body =
      path === '/api/transfer/export/preview'
        ? { codexLoginCacheAvailable: false }
        : path === '/api/transfer/preview'
          ? {
              exportedAt: '2026-08-18T00:00:00.000Z',
              profileCount: 1,
              harnesses: [{ harness: 'codex', profiles: 1 }],
              conflicts: [],
              activeCount: 1,
              conflictPolicy: request.conflictPolicy ?? 'skip',
              restoreActive: request.restoreActive === true,
              codexActivationAuthEffect: request.restoreActive === true ? 'openai-api-key' : 'none',
              codexLoginCache: { available: false, targetExists: true, migrationNeeded: false },
            }
          : {
              ok: true,
              imported: 1,
              overwritten: 0,
              skipped: 0,
              activeRestored: 0,
              codexLoginCacheMigrated: false,
              warnings: [],
            };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<TransferDialog open onOpenChange={() => {}} />);
  const file = new File(['ignored'], 'portable.hsw-backup', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(envelope) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  await screen.findByText('portable.hsw-backup');
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  expect(await screen.findByText(/OPENAI_API_KEY/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  expect(await screen.findByText('确认可能改动 Codex auth.json？')).toBeInTheDocument();
  expect(requests.filter((request) => request.path === '/api/transfer/import')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(requests.filter((request) => request.path === '/api/transfer/import')).toHaveLength(0);

  fireEvent.click(screen.getByLabelText('恢复导出时的激活状态'));
  expect(screen.getByText('已修改导入选项，请重新检查内容后再确认导入。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '请重新检查导入内容' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  await waitFor(() => expect(screen.queryByText(/OPENAI_API_KEY/)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  fireEvent.click(screen.getByRole('button', { name: '安全导入' }));
  await waitFor(() =>
    expect(requests.some((item) => item.path === '/api/transfer/import')).toBe(true),
  );
  const importRequest = requests.find((item) => item.path === '/api/transfer/import');
  expect(JSON.parse(importRequest?.body ?? '{}')).toMatchObject({ restoreActive: false });
});

test('closes on a successful import and reports the result in the toast', async () => {
  globalThis.fetch = (async (path: string) => {
    const body =
      path === '/api/transfer/export/preview'
        ? { codexLoginCacheAvailable: false }
        : path === '/api/transfer/preview'
          ? {
              exportedAt: '2026-08-18T00:00:00.000Z',
              profileCount: 2,
              harnesses: [{ harness: 'claude', profiles: 2 }],
              conflicts: [],
              activeCount: 0,
              conflictPolicy: 'skip',
              restoreActive: true,
              codexActivationAuthEffect: 'none',
              codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
            }
          : {
              ok: true,
              imported: 2,
              overwritten: 0,
              skipped: 1,
              activeRestored: 0,
              codexLoginCacheMigrated: false,
              warnings: [],
            };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  const closes: boolean[] = [];
  render(<TransferDialog open onOpenChange={(open) => closes.push(open)} />);
  const file = new File(['ignored'], 'portable.hsw-backup', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(envelope) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  await screen.findByText('portable.hsw-backup');
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
  fireEvent.click(await screen.findByRole('button', { name: '安全导入' }));

  // Import is the end of this flow, so the dialog gets out of the way instead of
  // leaving a finished form that looks like it still needs attention.
  await waitFor(() => expect(closes).toEqual([false]));
  const notice = useAppStore.getState().notice ?? [];
  expect(notice[0]?.key).toBe('transfer.importedSummary');
  expect(String(notice[0]?.params?.parts)).toContain('新增 2 项');
  expect(String(notice[0]?.params?.parts)).toContain('跳过 1 项');
  expect(screen.queryByText(/导入完成：/)).toBeNull();
});
