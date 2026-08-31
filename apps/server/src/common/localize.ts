import type { MessageParams } from '@seaveyon/harness-switch-shared';
import en from '../../../web/src/locales/en.json';
import zhCN from '../../../web/src/locales/zh-CN.json';

type ApiLanguage = 'en' | 'zh-CN';

/** Picks one of the API's supported languages from the standard request header. */
export function requestLanguage(acceptLanguage: string | undefined): ApiLanguage {
  return acceptLanguage?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
}

/**
 * The browser ships the same catalogs for instant client-side language switches.
 * The API also resolves its response prose so CLI and non-browser clients receive
 * a useful message in their requested language.
 */
export function localizeMessage(language: ApiLanguage, code: string, data?: MessageParams): string {
  const catalog = language === 'en' ? en : zhCN;
  const value =
    getPath(catalog, `error.${code}`) ??
    (typeof data?.count === 'number'
      ? getPath(catalog, `error.${code}_${data.count === 1 ? 'one' : 'other'}`)
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
