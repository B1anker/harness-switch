import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoticeToast } from '@/components/notice-toast';
import { useAppStore } from '@/stores/app-store';

test('shows a written-to-disk toast instead of a blocking dialog', async () => {
  useAppStore.setState({ notice: 'Claude Code 已切换到「main」。' });
  render(<NoticeToast />);

  expect(screen.getByRole('status')).toHaveTextContent('已写入磁盘');
  expect(screen.getByText(/已切换到/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(useAppStore.getState().notice).toBeNull());
});
