import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { applyTheme, preferredTheme, type Theme, toggleTheme } from '@/lib/theme';

export function ThemeToggle() {
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
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      onClick={() => setTheme((current) => toggleTheme(current))}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
