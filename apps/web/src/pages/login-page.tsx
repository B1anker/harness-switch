import { useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function LoginPage() {
  const { t } = useTranslation();
  const login = useAppStore((state) => state.login);
  const loading = useAppStore((state) => state.loading);
  const [error, setError] = useState<MessageLine | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await login(String(form.get('password') ?? ''));
    } catch (err) {
      setError(errorLine(err));
    }
  }

  return (
    <main className="grid min-h-[100dvh] lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r bg-card p-10 lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9 ring-1 ring-black/5 dark:ring-white/10" />
          <p className="font-mono text-xs text-muted-foreground">{t('app.brandMark')}</p>
        </div>
        <div className="max-w-sm space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{t('login.title')}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('login.intro')}</p>
        </div>
        <div className="flex gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <form className="w-full max-w-sm space-y-5" onSubmit={onSubmit}>
          <div className="flex items-start justify-between gap-3 lg:hidden">
            <div>
              <div className="flex items-center gap-2">
                <BrandMark className="size-7 ring-1 ring-black/5 dark:ring-white/10" />
                <p className="font-mono text-xs text-muted-foreground">{t('app.brandMark')}</p>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('login.title')}</h1>
            </div>
            <div className="flex gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('login.hint')}</p>
          <div className="space-y-2">
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input id="password" name="password" type="password" autoFocus required />
          </div>
          {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </section>
    </main>
  );
}
