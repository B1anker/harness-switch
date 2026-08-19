import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeToggle } from '@/components/theme-toggle';

test('toggles the html dark class and persists the choice', async () => {
  localStorage.setItem('hs-theme', 'light');
  document.documentElement.classList.remove('dark');
  render(<ThemeToggle />);

  const toDark = await screen.findByRole('button', { name: '切换到深色模式' });
  fireEvent.click(toDark);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('hs-theme')).toBe('dark');

  fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));
  await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
  expect(localStorage.getItem('hs-theme')).toBe('light');
});
