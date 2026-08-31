/**
 * The message catalogs, shared by the browser and the API.
 *
 * They live here rather than under `apps/web` because both apps need them: the web app
 * bundles them for instant language switching, and the server resolves `msg` on every
 * response so CLI and other non-browser clients get prose in their requested language.
 * When they lived in the web app, the server reached across the app boundary
 * (`../../../web/src/locales/en.json`) to read them.
 */
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

/** The languages the UI and the API both support. */
export const LANGUAGES = ['zh-CN', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** Used when no language is known or a stored/requested one is not recognised. */
export const FALLBACK_LANGUAGE: Language = 'zh-CN';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

/**
 * Keyed by language so a lookup needs no branch.
 *
 * Typed as a plain record of both catalogs rather than inferred: the two files have
 * identical key sets (asserted by `apps/server/test/localize.test.ts`), and letting
 * `en`'s literal type lead would make a key present in only one of them a silent
 * `undefined` at the call site instead of a type error in the catalog.
 */
export const CATALOGS: Record<Language, Record<string, unknown>> = {
  en,
  'zh-CN': zhCN,
};
