import { expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ThemeToggle } from '@/components/theme-toggle';
import { i18n } from '@/lib/i18n';
import { renderWithI18n } from './support';

test('toggles the html dark class and persists the choice', async () => {
  localStorage.setItem('hs-theme', 'light');
  document.documentElement.classList.remove('dark');
  await i18n.changeLanguage('zh-CN');
  renderWithI18n(<ThemeToggle />);

  const toDark = await screen.findByRole('button', { name: '切换到深色主题' });
  fireEvent.click(toDark);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('hs-theme')).toBe('dark');

  fireEvent.click(screen.getByRole('button', { name: '切换到浅色主题' }));
  await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
  expect(localStorage.getItem('hs-theme')).toBe('light');
});
