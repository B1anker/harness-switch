import { useState } from 'react';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/app-store';

export function LoginPage() {
  const login = useAppStore((state) => state.login);
  const loading = useAppStore((state) => state.loading);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await login(String(form.get('password') ?? ''));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="grid min-h-[100dvh] lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r bg-card p-10 lg:flex">
        <p className="font-mono text-xs text-muted-foreground">HS / harness-switch</p>
        <div className="max-w-sm space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">服务器端配置中枢</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            激活档案时直接写入各 CLI 自己的配置文件，不依赖你在某个 shell 里 source 过什么。
          </p>
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
              <p className="font-mono text-xs text-muted-foreground">HS / harness-switch</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">服务器端配置中枢</h1>
            </div>
            <div className="flex gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">输入首次启动时终端打印的 Web 密码。</p>
          <div className="space-y-2">
            <Label htmlFor="password">Web 密码</Label>
            <Input id="password" name="password" type="password" autoFocus required />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>
      </section>
    </main>
  );
}
