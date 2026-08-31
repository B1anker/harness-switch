/**
 * A drop-in replacement for `@pierre/theming/themes`, carrying the two themes the app
 * renders instead of all 76.
 *
 * `@pierre/diffs` registers every theme in `pierreThemes` and `shikiThemes` with its
 * resolver at module load. Each descriptor holds a dynamic `import()`, so the bundler
 * emits a chunk per theme: 76 chunks and 2.2MB of the built output. The viewer only ever
 * asks for `pierre-dark` or `pierre-light` (`THEME_NAMES` in
 * `components/pierre-file-diff.tsx`, matching the library's own `DEFAULT_THEMES`).
 *
 * `rspack.config.ts` aliases `@pierre/theming/themes` here. The upstream module's job is
 * to be the one place that reaches for theme payloads, which makes it the right seam: the
 * collection factory is re-used as-is, so the resolver sees the shape it expects.
 */
import { createThemeCollection } from '@pierre/theming';
import { normalizeTheme } from 'shiki/core';

type ThemeModule = { default: unknown };

type ThemeOptions = {
  name: string;
  load: () => Promise<ThemeModule> | Promise<unknown>;
  colorScheme?: 'dark' | 'light';
  collection?: string;
  displayName?: string;
};

/**
 * Mirrors the upstream `createTheme`: a descriptor whose loader hands the resolver a
 * normalized theme rather than the raw module.
 *
 * Reimplemented rather than imported because `@pierre/theming` only exports it from
 * `./themes` — the very module this file stands in for, so importing it would be
 * circular. It is a thin wrapper over `normalizeTheme`, which is public API.
 */
export function createTheme({ name, load, colorScheme, collection, displayName }: ThemeOptions) {
  return {
    name,
    colorScheme,
    collection,
    displayName,
    load: async () => {
      const loaded = (await load()) as ThemeModule;
      return normalizeTheme(
        (loaded !== null && typeof loaded === 'object' && 'default' in loaded
          ? loaded.default
          : loaded) as Parameters<typeof normalizeTheme>[0],
      );
    },
  };
}

/**
 * Only the two themes `pierre-file-diff.tsx` selects between. Adding a theme to the UI
 * means adding it here too, or its `resolveTheme` will throw "No valid theme loader
 * registered".
 */
export const pierreThemes = createThemeCollection({
  themes: [
    createTheme({
      name: 'pierre-dark',
      collection: 'pierre',
      colorScheme: 'dark',
      displayName: 'Pierre Dark',
      load: () => import('@pierre/theme/pierre-dark'),
    }),
    createTheme({
      name: 'pierre-light',
      collection: 'pierre',
      colorScheme: 'light',
      displayName: 'Pierre Light',
      load: () => import('@pierre/theme/pierre-light'),
    }),
  ],
});

/**
 * Empty: the Shiki-packaged themes are the 2.2MB we are dropping. `@pierre/diffs` only
 * consults this collection as a fallback for a theme name its resolver does not already
 * know, and both names we use are registered above.
 */
export const shikiThemes = createThemeCollection({ themes: [] });

export const themes = pierreThemes;
