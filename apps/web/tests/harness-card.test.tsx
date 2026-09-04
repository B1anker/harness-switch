import { beforeEach, expect, test } from '@rstest/core';
import type { ProfilePublic } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { HarnessCard } from '@/components/harness-card';
import { harnessFixture, profileFixture, status, stubFetch, stubStoreActions } from './support';

beforeEach(() => {
  // The activation dialog fetches a preview on open; keep it offline in unit tests.
  stubFetch(() => status(500, { error: 'offline' }));
});

test('shows the active profile and marks the one taken over by hand', () => {
  stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        active: { name: 'openrouter-main', baseUrl: 'https://api.example.com/v1', model: '' },
        profiles: [
          profileFixture(),
          profileFixture({
            name: 'spare',
            baseUrl: 'https://spare.example.com/v1',
            overriddenTargets: ['settings'],
          }),
        ],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  expect(screen.getByText('当前：openrouter-main')).toBeInTheDocument();
  expect(screen.getByText('已激活', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
  expect(screen.getByText('手动接管')).toBeInTheDocument();
  expect(screen.getByText('https://api.example.com/v1')).toBeInTheDocument();
});

test('says so when there is nothing configured yet', () => {
  render(<HarnessCard harness={harnessFixture()} onAdd={() => {}} onEdit={() => {}} />);
  expect(screen.getByText('还没有配置档案')).toBeInTheDocument();
});

test('activating opens the diff confirmation before switching', () => {
  render(
    <HarnessCard
      harness={harnessFixture({ profiles: [profileFixture()] })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '激活' }));
  expect(screen.getByRole('heading', { name: '激活配置？' })).toBeInTheDocument();
  expect(screen.getByText(/将把 Claude Code 切换到「openrouter-main」/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认激活' })).toBeInTheDocument();
});

test('offers a built-in official login with preview and confirmation', () => {
  render(<HarnessCard harness={harnessFixture()} onAdd={() => {}} onEdit={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: '切回官方' }));

  expect(screen.getByRole('heading', { name: '切回官方登录？' })).toBeInTheDocument();
  expect(screen.getByText(/Claude Code 自身的 Anthropic 账号登录/)).toBeInTheDocument();
});

test('only shows the DSH official API switch after detecting its native credential', () => {
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'dsh',
        label: 'DeepSeek Harness',
        official: undefined,
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  expect(screen.queryByText('DeepSeek 官方')).toBeNull();
});

test('merges a saved DSH official API profile with the detected native entry', () => {
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'dsh',
        label: 'DeepSeek Harness',
        official: {
          kind: 'native-api',
          available: true,
          active: false,
          titleCode: 'harness.deepseekOfficial',
          hintCode: 'harness.officialHintDsh',
          linkedProfileName: 'deepseek-official',
        },
        // A legacy named activation is not the native official state; the pinned
        // action must remain available so it can restore that state.
        active: {
          name: 'deepseek-official',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
        },
        profiles: [
          profileFixture({
            harness: 'dsh',
            name: 'deepseek-official',
            extras: { providerType: 'official' },
          }),
        ],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  expect(screen.getAllByText('DeepSeek 官方')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '切回官方' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '编辑 deepseek-official' })).toBeInTheDocument();
  expect(screen.queryByText('https://api.example.com/v1')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '切回官方' }));
  expect(screen.getByRole('heading', { name: '切回官方登录？' })).toBeInTheDocument();
});

test('editing hands the whole profile back, so the form can prefill', () => {
  stubStoreActions(['activateProfile']);
  const edited: ProfilePublic[] = [];
  render(
    <HarnessCard
      harness={harnessFixture({ profiles: [profileFixture()] })}
      onAdd={() => {}}
      onEdit={(profile) => edited.push(profile)}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '编辑 openrouter-main' }));
  expect(edited[0]?.name).toBe('openrouter-main');
  expect(edited[0]?.model).toBe('claude-sonnet-4-5');
});

test('copying hands the profile to the editable copy flow', () => {
  const copied: ProfilePublic[] = [];
  render(
    <HarnessCard
      harness={harnessFixture({ profiles: [profileFixture()] })}
      onAdd={() => {}}
      onEdit={() => {}}
      onCopy={(profile) => copied.push(profile)}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '复制 openrouter-main' }));
  expect(copied[0]?.name).toBe('openrouter-main');
});

test('the active profile cannot be deleted, and says why', () => {
  stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        active: { name: 'openrouter-main', baseUrl: '', model: '' },
        profiles: [profileFixture()],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  const remove = screen.getByRole('button', { name: '删除 openrouter-main' });
  // Deleting it would leave an orphan provider in the harness's own config file.
  expect(remove).toBeDisabled();
  expect(remove).toHaveAttribute('title', '先激活另一个配置，才能删除当前配置');
});

test('deleting asks for confirmation before calling the store', () => {
  const calls = stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({ profiles: [profileFixture()] })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '删除 openrouter-main' }));
  expect(calls.deleteProfile).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(calls.deleteProfile).toEqual([['claude', 'openrouter-main']]);
});

test('kimi uses default/provider wording like dsh, not activate/profile', () => {
  stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'kimi',
        label: 'Kimi Code',
        mode: 'additive',
        profiles: [profileFixture({ harness: 'kimi' })],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  expect(screen.getByText('提供方')).toBeInTheDocument();
  expect(screen.getByText('默认模型')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '设为默认' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '激活' })).toBeNull();
});

test('warns that an additive harness also loses its provider entry', () => {
  stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'kimi',
        label: 'Kimi Code',
        mode: 'additive',
        profiles: [profileFixture({ harness: 'kimi' })],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '删除 openrouter-main' }));
  expect(screen.getByText(/provider 条目也会被一并摘掉/)).toBeInTheDocument();
});

test('allows deleting a non-default duplicate DSH official record', () => {
  const calls = stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'dsh',
        label: 'DeepSeek Harness',
        mode: 'additive',
        official: undefined,
        active: {
          name: 'official',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
        },
        profiles: [
          profileFixture({
            harness: 'dsh',
            name: 'official',
            extras: { providerType: 'official' },
          }),
          profileFixture({
            harness: 'dsh',
            name: 'deepseek-official',
            extras: { providerType: 'official' },
          }),
        ],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  const duplicateDelete = screen.getByRole('button', { name: '删除 deepseek-official' });
  expect((duplicateDelete as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(duplicateDelete);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(calls.deleteProfile).toEqual([['dsh', 'deepseek-official']]);
});

test('explains that deleting the last unmanaged DSH official profile clears its native route', () => {
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'dsh',
        label: 'DeepSeek Harness',
        mode: 'additive',
        official: undefined,
        profiles: [
          profileFixture({
            harness: 'dsh',
            name: 'official',
            extras: { providerType: 'official' },
          }),
        ],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '删除 official' }));
  expect(screen.getByText(/DeepSeek 原生路由和凭据引用也会被一并移除/)).toBeInTheDocument();
});

test('keeps legacy duplicate DSH official records manageable after pinning the primary one', () => {
  const calls = stubStoreActions(['activateProfile', 'deleteProfile']);
  render(
    <HarnessCard
      harness={harnessFixture({
        id: 'dsh',
        label: 'DeepSeek Harness',
        mode: 'additive',
        official: {
          kind: 'native-api',
          available: true,
          active: false,
          titleCode: 'harness.deepseekOfficial',
          hintCode: 'harness.officialHintDsh',
          linkedProfileName: 'official',
        },
        profiles: [
          profileFixture({
            harness: 'dsh',
            name: 'official',
            extras: { providerType: 'official' },
          }),
          profileFixture({
            harness: 'dsh',
            name: 'legacy-official',
            extras: { providerType: 'official' },
          }),
        ],
      })}
      onAdd={() => {}}
      onEdit={() => {}}
    />,
  );

  expect(
    (screen.getByRole('button', { name: '删除 legacy-official' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '删除 legacy-official' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(calls.deleteProfile).toEqual([['dsh', 'legacy-official']]);
});
