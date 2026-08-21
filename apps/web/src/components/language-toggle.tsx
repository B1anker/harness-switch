import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function LanguageToggle() {
  const { language, setLanguage } = useI18n();
  const english = language === 'en';

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-i18n-ignore
      aria-label={english ? 'Switch to Chinese' : 'Switch to English'}
      title={english ? 'Switch to Chinese' : 'Switch to English'}
      onClick={() => setLanguage(english ? 'zh-CN' : 'en')}
    >
      <Languages />
      <span className="hidden sm:inline">{english ? '中文' : 'EN'}</span>
    </Button>
  );
}
