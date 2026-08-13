import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
            HARNESS SWITCH
          </p>
          <CardTitle className="text-2xl">服务器端配置中枢</CardTitle>
          <CardDescription>输入首次启动时终端打印的 Web 密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="password">Web 密码</Label>
              <Input id="password" name="password" type="password" autoFocus required />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
