import { expect, test } from '@rstest/core';
import type { TransferConflictPolicy, TransferPreview } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { buildImportNotice, ImportReview } from '@/components/import-review';
import { i18n } from '@/lib/i18n';

function previewFixture(overrides: Partial<TransferPreview> = {}): TransferPreview {
  return {
    exportedAt: '2026-08-28T00:00:00.000Z',
    profileCount: 4,
    providerCount: 2,
    harnesses: [
      { harness: 'claude', profiles: 3 },
      { harness: 'codex', profiles: 1 },
    ],
    conflicts: [{ harness: 'claude', name: 'main' }],
    activeCount: 1,
    conflictPolicy: 'skip',
    restoreActive: true,
    codexActivationAuthEffect: 'none',
    codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
    ...overrides,
  };
}

/**
 * A host that behaves like the real sources: it echoes option changes into the preview only
 * when re-checked, so `stale` can be exercised through the component's own props.
 */
function Host({ preview }: { preview: TransferPreview }) {
  const [policy, setPolicy] = useState<TransferConflictPolicy>(preview.conflictPolicy);
  const [restoreActive, setRestoreActive] = useState(preview.restoreActive);
  const [checked, setChecked] = useState(preview);
  const [confirmed, setConfirmed] = useState(0);
  const stale = checked.conflictPolicy !== policy || checked.restoreActive !== restoreActive;

  return (
    <>
      <ImportReview
        idPrefix="host"
        preview={checked}
        conflictPolicy={policy}
        restoreActive={restoreActive}
        stale={stale}
        pending={false}
        canImport={!stale}
        onPolicyChange={setPolicy}
        onRestoreActiveChange={setRestoreActive}
        onConfirm={() => setConfirmed((count) => count + 1)}
      />
      <button
        type="button"
        onClick={() => setChecked({ ...checked, conflictPolicy: policy, restoreActive })}
      >
        recheck
      </button>
      <p>confirmed:{confirmed}</p>
    </>
  );
}

test('summarises what the package holds and which names collide', () => {
  render(
    <ImportReview
      idPrefix="review"
      preview={previewFixture()}
      conflictPolicy="skip"
      restoreActive
      stale={false}
      pending={false}
      canImport
      onPolicyChange={() => {}}
      onRestoreActiveChange={() => {}}
      onConfirm={() => {}}
    />,
  );

  expect(screen.getByText('4 个配置')).toBeInTheDocument();
  expect(screen.getByText('2 条凭据')).toBeInTheDocument();
  expect(screen.getByText('1 个同名冲突')).toBeInTheDocument();
  expect(screen.getByText('1 个激活状态')).toBeInTheDocument();
  expect(screen.getByText('Claude Code：3')).toBeInTheDocument();
  expect(screen.getByText('同名项：Claude Code / main')).toBeInTheDocument();
  // The policy in force is named next to the conflicts it decides.
  expect(screen.getByText('当前策略：保留本机配置，跳过导入')).toBeInTheDocument();
});

test('changing an option blocks the import until the preview is re-checked', () => {
  render(<Host preview={previewFixture()} />);

  expect(screen.getByRole('button', { name: '确认导入' })).toBeEnabled();

  fireEvent.click(screen.getByLabelText('恢复导出时的激活状态'));

  // The preview is kept on screen — it is still the last true answer, just not for these
  // options — and the button says why it cannot be used.
  expect(screen.getByText('已修改导入选项，请重新检查内容后再确认导入。')).toBeInTheDocument();
  expect(screen.getByText('4 个配置')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '请重新检查导入内容' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'recheck' }));
  expect(screen.queryByText('已修改导入选项，请重新检查内容后再确认导入。')).toBeNull();
  expect(screen.getByRole('button', { name: '确认导入' })).toBeEnabled();
});

test('a stale preview hides the activation warning it can no longer vouch for', () => {
  render(<Host preview={previewFixture({ codexActivationAuthEffect: 'openai-api-key' })} />);

  expect(screen.getByText(/OPENAI_API_KEY/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('恢复导出时的激活状态'));
  expect(screen.queryByText(/OPENAI_API_KEY/)).toBeNull();
});

test('the confirmation names the auth risk and only imports once acknowledged', () => {
  render(<Host preview={previewFixture({ codexActivationAuthEffect: 'auth-override' })} />);

  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  expect(screen.getByText('确认可能改动 Codex auth.json？')).toBeInTheDocument();
  expect(screen.getByText('confirmed:0')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByText('confirmed:0')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  fireEvent.click(screen.getByRole('button', { name: '了解并继续导入' }));
  expect(screen.getByText('confirmed:1')).toBeInTheDocument();
});

test('the import notice lists only the counts that happened, in one order', () => {
  const t = i18n.getFixedT('zh-CN');
  const notice = buildImportNotice(t, {
    ok: true,
    imported: 2,
    overwritten: 0,
    skipped: 1,
    providersCopied: 3,
    activeRestored: 0,
    codexLoginCacheMigrated: false,
    warnings: [{ code: 'warning.transfer.credentialMissing' }],
  });

  expect(notice[0]?.key).toBe('transfer.importedSummary');
  const parts = String(notice[0]?.params?.parts);
  expect(parts).toBe('新增 2 项、恢复 3 条凭据、跳过 1 项、未迁移导出包内的 Codex 登录缓存');
  // Warnings ride along as their own lines so they follow a language switch too.
  expect(notice[1]?.key).toBe('warning.transfer.credentialMissing');
});
