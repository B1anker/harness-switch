import { expect, test } from '@rstest/core';
import { render, screen, waitFor } from '@testing-library/react';
import { NoticeToast } from '@/components/notice-toast';
import { I18nProvider, i18n } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';

test('fires a toast per notice line and clears the queue', async () => {
  await i18n.changeLanguage('zh-CN');
  useAppStore.setState({
    notice: [{ key: 'notice.switchDone' }],
  });
  render(
    <I18nProvider>
      <NoticeToast />
    </I18nProvider>,
  );

  expect(await screen.findByText('切换完成')).toBeInTheDocument();
  await waitFor(() => expect(useAppStore.getState().notice).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();
});
