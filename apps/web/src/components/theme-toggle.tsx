import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { applyTheme, preferredTheme, type Theme, toggleTheme } from '@/lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const next = preferredTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
      onClick={() => setTheme((current) => toggleTheme(current))}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
