import type { Language, MessageParams } from '@seaveyon/harness-switch-shared';
import { CATALOGS, catalogKey } from '@seaveyon/harness-switch-shared';

/**
 * Prose for the terminal, from the same catalogs the browser and the API use.
 *
 * The CLI renders its own output — prompts, table headers, confirmations — so without
 * this it would need a second copy of every string. It resolves keys locally and sends
 * the chosen language as `Accept-Language`, so a `msg` that came back from the server
 * is already in the language the rest of the output is in.
 */

/** Honours the POSIX precedence, so `LC_ALL=en_US` wins over a zh `LANG`. */
export function resolveCliLanguage(env: NodeJS.ProcessEnv = process.env): Language {
  const requested = env.HSW_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return /^en\b|^en[_-]/i.test(requested.trim()) ? 'en' : 'zh-CN';
}

export type CliTranslate = (key: string, params?: MessageParams) => string;

/**
 * A translator bound to one language. Missing keys return the key itself rather than
 * throwing: a half-translated catalog must not take the command down with it.
 */
export function createCliTranslate(language: Language): CliTranslate {
  const catalog = CATALOGS[language];
  return (key, params) => {
    const value = getPath(catalog, catalogKey(key)) ?? getPath(catalog, key);
    if (typeof value !== 'string') {
      return key;
    }
    return value.replace(/{{\s*([\w.]+)\s*}}/g, (_match, name: string) =>
      params?.[name] === undefined ? '' : String(params[name]),
    );
  };
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
}

let shared: CliTranslate | undefined;

/**
 * The process-wide CLI translator, resolved from the environment on first use.
 *
 * Every CLI string goes through this, including the messages thrown from the argument
 * parser before any command runs, so it has to be reachable without threading a language
 * argument through call sites that never see one.
 */
export function cliText(key: string, params?: MessageParams): string {
  if (!shared) {
    shared = createCliTranslate(resolveCliLanguage());
  }
  return shared(key, params);
}

/** Test seam: drops the cached translator so the next call re-reads the environment. */
export function resetCliLanguage(): void {
  shared = undefined;
}
