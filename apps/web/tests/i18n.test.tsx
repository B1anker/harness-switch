import { expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageToggle } from '@/components/language-toggle';
import { I18nProvider, i18n, useTranslation } from '@/lib/i18n';

test('resolves catalog keys in both languages', async () => {
  await i18n.changeLanguage('zh-CN');
  expect(i18n.t('harness.currentInactive')).toBe('当前：未激活');
  expect(i18n.t('drift.mismatch_other', { count: 3 })).toBe('3 个文件不一致');

  await i18n.changeLanguage('en');
  expect(i18n.t('harness.currentInactive')).toBe('Current: inactive');
  expect(i18n.t('drift.mismatch_other', { count: 3 })).toBe('3 files differ');
});

function SampleCopy() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageToggle />
      <label htmlFor="password">{t('login.password')}</label>
      <p>{t('login.hint')}</p>
    </>
  );
}

test('switches languages, translates copy, and persists the choice', async () => {
  localStorage.setItem('hs-language', 'zh-CN');
  await i18n.changeLanguage('zh-CN');
  render(
    <I18nProvider>
      <SampleCopy />
    </I18nProvider>,
  );

  expect(screen.getByText('Web 密码')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(await screen.findByText('Web password')).toBeInTheDocument();
  expect(localStorage.getItem('hs-language')).toBe('en');
  expect(document.documentElement.lang).toBe('en');

  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(await screen.findByText('Web 密码')).toBeInTheDocument();
  expect(localStorage.getItem('hs-language')).toBe('zh-CN');
});
