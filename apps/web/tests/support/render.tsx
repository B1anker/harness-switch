import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '@/lib/i18n';

/**
 * Renders inside the i18n provider, for the components that resolve their own prose.
 *
 * Most components read translations through a parent that the test does not mount, so a
 * bare `render` is enough; use this only when the component under test calls `useTranslation`
 * itself.
 */
export function renderWithI18n(ui: ReactElement): RenderResult {
  return render(<I18nProvider>{ui}</I18nProvider>);
}
