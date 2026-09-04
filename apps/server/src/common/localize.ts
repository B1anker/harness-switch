import type { Language, MessageParams } from '@seaveyon/harness-switch-shared';
import { CATALOGS, catalogKey } from '@seaveyon/harness-switch-shared';

/** Picks one of the API's supported languages from the standard request header. */
export function requestLanguage(acceptLanguage: string | undefined): Language {
  return acceptLanguage?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
}

/**
 * The browser ships the same catalogs for instant client-side language switches.
 * The API also resolves its response prose so CLI and non-browser clients receive
 * a useful message in their requested language.
 */
export function localizeMessage(language: Language, code: string, data?: MessageParams): string {
  const catalog = CATALOGS[language];
  const key = catalogKey(code);
  const value =
    getPath(catalog, key) ??
    (typeof data?.count === 'number'
      ? getPath(catalog, `${key}_${data.count === 1 ? 'one' : 'other'}`)
      : undefined);
  if (typeof value !== 'string') {
    return language === 'en' ? 'Request failed' : '请求失败';
  }
  return value.replace(/{{\s*([\w.]+)\s*}}/g, (_match, name: string) =>
    data?.[name] === undefined ? '' : String(data[name]),
  );
}

/** @deprecated Use {@link localizeMessage}; kept for the error-handler call sites. */
export const localizeError = localizeMessage;

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}
