import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoticeToast } from '@/components/notice-toast';
import { I18nProvider, i18n } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';

test('shows a written-to-disk toast instead of a blocking dialog', async () => {
  await i18n.changeLanguage('zh-CN');
  useAppStore.setState({
    notice: [
      {
        key: 'notice.activated',
        params: { harness: 'Claude Code', profile: 'main', user: 'root' },
      },
    ],
  });
  render(
    <I18nProvider>
      <NoticeToast />
    </I18nProvider>,
  );

  expect(screen.getByRole('status')).toHaveTextContent('已写入磁盘');
  expect(screen.getByText(/已切换到/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(useAppStore.getState().notice).toBeNull());
});
