import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// rstest.setup.ts registers these matchers at runtime; this teaches the compiler about them.
declare module '@rstest/core' {
  // biome-ignore lint/suspicious/noExplicitAny: must match the upstream type parameter exactly
  interface Assertion<T = any> extends TestingLibraryMatchers<T, void> {}
}
