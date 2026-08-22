import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n, useTranslation } from '@/lib/i18n';

export function LanguageToggle() {
  const { t } = useTranslation();
  const { language, setLanguage } = useI18n();
  const english = language === 'en';
  // Deliberately the *other* language's own name, so the button reads to someone who
  // cannot yet read the current one.
  const label = english ? t('language.toChinese') : t('language.toEnglish');

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      title={label}
      onClick={() => setLanguage(english ? 'zh-CN' : 'en')}
    >
      <Languages />
      <span className="hidden sm:inline">{t('language.short')}</span>
    </Button>
  );
}
