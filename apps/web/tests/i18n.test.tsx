import { expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageToggle } from '@/components/language-toggle';
import { I18nProvider, translateToEnglish } from '@/lib/i18n';

test('translates catalog text including dynamic fragments', () => {
  expect(translateToEnglish('当前：未激活')).toBe('Current: inactive');
  expect(translateToEnglish('3 个文件不一致')).toBe('3 files differ');
});

test('switches languages, translates attributes, and persists the choice', () => {
  localStorage.setItem('hs-language', 'zh-CN');
  render(
    <I18nProvider>
      <LanguageToggle />
      <label htmlFor="password">Web 密码</label>
      <input id="password" placeholder="请输入配置名称" />
    </I18nProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(screen.getByText('Web password')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Enter a profile name')).toBeInTheDocument();
  expect(localStorage.getItem('hs-language')).toBe('en');
  expect(document.documentElement.lang).toBe('en');

  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(screen.getByText('Web 密码')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('请输入配置名称')).toBeInTheDocument();
  expect(localStorage.getItem('hs-language')).toBe('zh-CN');
});
