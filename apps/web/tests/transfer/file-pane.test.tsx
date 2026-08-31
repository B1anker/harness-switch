import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilePane } from '@/components/transfer/file-pane';
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

/** Hands the pane a `.hsw-backup` the same way the file picker would. */
async function pickEnvelope() {
  const file = new File(['ignored'], 'portable.hsw-backup', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(envelope) });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  await screen.findByText('portable.hsw-backup');
}

test('exports all profiles only after the migration password is confirmed', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<FilePane onDone={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '导出所有配置' }));
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
    includeCodexLoginCache: true,
  });
  expect(await screen.findByText(/加密导出包已生成/)).toBeInTheDocument();
});

test('automatically migrates Codex login cache on import without separate checkbox', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/transfer/preview'
        ? {
            exportedAt: '2026-08-18T00:00:00.000Z',
            profileCount: 0,
            providerCount: 0,
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
            providersCopied: 0,
            activeRestored: 0,
            codexLoginCacheMigrated: true,
            warnings: [],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<FilePane onDone={() => {}} />);
  await pickEnvelope();
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  await screen.findByRole('button', { name: '确认导入' });
  expect(screen.queryByLabelText(/迁移 Codex 官方登录缓存/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

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
      path === '/api/transfer/preview'
        ? {
            exportedAt: '2026-08-18T00:00:00.000Z',
            profileCount: 1,
            providerCount: 0,
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
            providersCopied: 0,
            activeRestored: 0,
            codexLoginCacheMigrated: false,
            warnings: [],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<FilePane onDone={() => {}} />);
  await pickEnvelope();
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

test('reports the result in the toast and lets the dialog get out of the way', async () => {
  globalThis.fetch = (async (path: string) => {
    const body =
      path === '/api/transfer/preview'
        ? {
            exportedAt: '2026-08-18T00:00:00.000Z',
            profileCount: 2,
            providerCount: 0,
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
            providersCopied: 0,
            activeRestored: 0,
            codexLoginCacheMigrated: false,
            warnings: [],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  let done = 0;
  render(<FilePane onDone={() => (done += 1)} />);
  await pickEnvelope();
  fireEvent.change(screen.getByLabelText('迁移密码', { selector: '#import-passphrase' }), {
    target: { value: 'portable-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: '检查导入内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
  fireEvent.click(await screen.findByRole('button', { name: '安全导入' }));

  // Import is the end of this flow, so the dialog gets out of the way instead of
  // leaving a finished form that looks like it still needs attention.
  await waitFor(() => expect(done).toBe(1));
  const notice = useAppStore.getState().notice ?? [];
  expect(notice[0]?.key).toBe('transfer.importedSummary');
  expect(String(notice[0]?.params?.parts)).toContain('新增 2 项');
  expect(String(notice[0]?.params?.parts)).toContain('跳过 1 项');
  expect(screen.queryByText(/导入完成：/)).toBeNull();
});

test('rejects a file that is not a harness-switch export', async () => {
  render(<FilePane onDone={() => {}} />);
  const file = new File(['{}'], 'notes.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => '{"format":"something-else"}' });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });

  expect(await screen.findByText('不是有效的 harness-switch 导出文件')).toBeInTheDocument();
  expect(screen.queryByText('notes.json')).toBeNull();
});
