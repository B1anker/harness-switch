/**
 * A drop-in replacement for the `shiki` package entry, carrying three grammars instead
 * of ~250.
 *
 * `@pierre/diffs` resolves grammars through `bundledLanguages` from `shiki`, whose full
 * bundle registers a dynamic `import()` per language. A bundler cannot know which of
 * those the app will ask for, so it emits a chunk for every one: 248 chunks and 9.8MB of
 * the built output, for a viewer that only ever renders harness config files.
 *
 * `rspack.config.ts` aliases `shiki` here. Everything else the package exports comes
 * straight from `shiki/core`, so the only behavioural difference is the narrower language
 * set — and `pierre-file-diff.tsx` guarantees we never request anything outside it.
 */
import type { ThemeInput } from 'shiki/core';
import {
  createBundledHighlighter,
  createSingletonShorthands,
  guessEmbeddedLanguages,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Re-exported wholesale: `@pierre/diffs` pulls tokenizer helpers, theme normalization and
// a pile of types from the same `shiki` specifier we are standing in for.
export * from 'shiki/core';

// The real `shiki` entry also re-exports both regex engines, and `@pierre/diffs` imports
// them from it directly.
export * from 'shiki/engine/javascript';
export * from 'shiki/engine/oniguruma';

/**
 * Every grammar the app can request, keyed exactly as Shiki names them.
 *
 * `yml` is a separate key because Shiki treats it as its own language id; both point at
 * the one YAML grammar. All three grammars are self-contained (no `embeddedLangs`), so
 * loading one cannot pull a fourth in behind it.
 *
 * `components/pierre-file-diff.tsx` imports this to build its extension map, so the set of
 * languages that can be asked for is derived from the set that can be answered rather than
 * kept in step by hand.
 */
export const bundledLanguages = {
  json: () => import('shiki/langs/json.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  yml: () => import('shiki/langs/yaml.mjs'),
};

/** The language ids this build can highlight; everything else must render as plain text. */
export type BundledLanguageId = keyof typeof bundledLanguages;

/**
 * Empty on purpose. Themes reach the highlighter through `@pierre/theming`'s resolver
 * (see `shiki/themes.ts`), never through this map.
 *
 * Typed as an open record rather than left to infer: an empty literal would narrow the
 * bundle's theme parameter to `never`, which then rejects every helper that expects a
 * theme name.
 */
export const bundledThemes: Record<string, ThemeInput> = {};

export const bundledLanguagesBase = bundledLanguages;
export const bundledLanguagesAlias = {};
export const bundledLanguagesInfo = Object.keys(bundledLanguages).map((id) => ({
  id,
  name: id,
  import: bundledLanguages[id as keyof typeof bundledLanguages],
}));
export const bundledThemesInfo = [];

/**
 * The engine is the JavaScript regex one rather than Oniguruma, which keeps a 608KB
 * inlined wasm binary out of the bundle. Verified against all three grammars: they
 * tokenize with no engine warnings, since none of them use patterns the JS engine cannot
 * translate. `@pierre/diffs` passes its own engine on every call anyway — this default
 * only covers the paths that do not.
 */
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});

export const {
  codeToHtml,
  codeToHast,
  codeToTokens,
  codeToTokensBase,
  codeToTokensWithThemes,
  getSingletonHighlighter,
  getLastGrammarState,
} = createSingletonShorthands(createHighlighter, { guessEmbeddedLanguages });
