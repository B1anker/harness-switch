import {
  CATALOGS,
  FALLBACK_LANGUAGE,
  isLanguage,
  LANGUAGES,
  type Language,
} from '@seaveyon/harness-switch-shared';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from 'react';
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next';

export { LANGUAGES, type Language };

const STORAGE_KEY = 'hs-language';

/**
 * Locale used for `Intl` formatting. i18next's language tag stays short so keys
 * resolve with one lookup, while dates and numbers want a region.
 */
const LOCALES: Record<Language, string> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
};

/** Reads the persisted choice. Private-mode browsers throw on access, so this never rejects. */
function storedLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : FALLBACK_LANGUAGE;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

export const i18n: I18nInstance = i18next.createInstance();

i18n.use(initReactI18next).init({
  lng: storedLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  resources: {
    'zh-CN': { translation: CATALOGS['zh-CN'] },
    en: { translation: CATALOGS.en },
  },
  // Resources are bundled, so there is nothing to load asynchronously and init
  // completes before the first render.
  initAsync: false,
  // React escapes for us; escaping here would double-encode profile names.
  interpolation: { escapeValue: false },
  returnNull: false,
});

function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

type I18nValue = {
  language: Language;
  /** BCP 47 tag for `Intl` formatters. */
  locale: string;
  setLanguage: (language: Language) => void;
};

function subscribe(onChange: () => void): () => void {
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
}

function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}

/**
 * Language state for components that need the tag itself — a locale-aware
 * formatter, or the toggle. Plain copy should use `useTranslation` instead.
 */
export function useI18n(): I18nValue {
  const language = useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
  const setLanguage = useCallback((next: Language) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A rejected write only costs the user their preference on the next visit.
    }
    void i18n.changeLanguage(next);
  }, []);

  return useMemo(
    () => ({ language, locale: LOCALES[language], setLanguage }),
    [language, setLanguage],
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export { useTranslation };
