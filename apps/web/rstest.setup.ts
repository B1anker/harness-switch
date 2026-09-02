import { afterEach, beforeEach, expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { i18n } from '@/lib/i18n';

expect.extend(jestDomMatchers);

/**
 * happy-dom 18 does not provide `localStorage`, which the theme and language
 * preferences persist through. Production code guards its access with try/catch, so
 * without a stand-in the tests would silently exercise the failure path instead of
 * the persistence they mean to assert.
 */
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

beforeEach(async () => {
  // Each test starts from no stored preference, so one test's choice cannot decide
  // what the next one reads back.
  localStorage.clear();
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
