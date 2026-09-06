import { expect, test } from '@rstest/core';
import { formatTokenField, formatTokens } from '@/lib/format-tokens';

test('multiples of 1024 render as NK, anything else keeps the plain digits', () => {
  expect(formatTokens(262144)).toBe('256K');
  expect(formatTokens(32768)).toBe('32K');
  expect(formatTokens(131072)).toBe('128K');
  expect(formatTokens(1000)).toBe('1000');
  expect(formatTokens(1025)).toBe('1025');
  expect(formatTokens(0)).toBe('0');
});

test('formatTokenField only touches integer values of token-count fields', () => {
  expect(formatTokenField('extras.contextWindow', '262144')).toBe('256K');
  expect(formatTokenField('maxTokens', '8192')).toBe('8K');
  expect(formatTokenField('model', '262144')).toBe('262144');
  expect(formatTokenField('extras.contextWindow', '100000')).toBe('100000');
  expect(formatTokenField('extras.contextWindow', null)).toBeNull();
  expect(formatTokenField('extras.contextWindow', 'n/a')).toBe('n/a');
});
