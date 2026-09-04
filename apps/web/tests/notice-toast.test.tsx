import { expect, test } from '@rstest/core';
import { screen, waitFor } from '@testing-library/react';
import { NoticeToast } from '@/components/notice-toast';
import { i18n } from '@/lib/i18n';
import { useAppStore } from '@/stores/app-store';
import { renderWithI18n, setStoreState } from './support';

test('fires a toast per notice line and clears the queue', async () => {
  await i18n.changeLanguage('zh-CN');
  setStoreState({ notice: [{ key: 'notice.switchDone' }] });
  renderWithI18n(<NoticeToast />);

  expect(await screen.findByText('切换完成')).toBeInTheDocument();
  await waitFor(() => expect(useAppStore.getState().notice).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();
});
