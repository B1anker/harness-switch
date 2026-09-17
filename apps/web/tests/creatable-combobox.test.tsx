import { expect, test } from '@rstest/core';
import { fireEvent, screen } from '@testing-library/react';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { renderWithI18n } from './support';

test('disabled options stay visible and cannot be selected', () => {
  const chosen: string[] = [];
  renderWithI18n(
    <CreatableCombobox
      id="combo"
      aria-invalid={undefined}
      aria-describedby={undefined}
      value=""
      options={['daily', 'spare']}
      getLabel={(id) => id}
      isOptionDisabled={(id) => id === 'daily'}
      disabledHint="已有配置"
      onChange={(value) => chosen.push(value)}
      placeholder="选择"
      searchLabel="搜索"
      emptyHint="空"
    />,
  );
  fireEvent.click(screen.getByRole('combobox'));
  expect(screen.getByText('已有配置')).toBeInTheDocument();
  fireEvent.click(screen.getByText('daily'));
  expect(chosen).toEqual([]);
  fireEvent.click(screen.getByText('spare'));
  expect(chosen).toEqual(['spare']);
});
