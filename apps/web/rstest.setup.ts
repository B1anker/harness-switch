import { afterEach, beforeEach, expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { i18n } from '@/lib/i18n';

expect.extend(jestDomMatchers);

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

// Radix Select relies on Pointer Events APIs that happy-dom does not implement.
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => {} },
  scrollIntoView: { configurable: true, value: () => {} },
  setPointerCapture: { configurable: true, value: () => {} },
});

afterEach(() => {
  cleanup();
});
