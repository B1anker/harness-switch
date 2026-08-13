import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { HarnessCard } from '@/components/harness-card';
import { ProfileDialog } from '@/components/profile-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';

export function DashboardPage() {
  const harnesses = useAppStore((state) => state.harnesses);
  const envFile = useAppStore((state) => state.envFile);
  const notice = useAppStore((state) => state.notice);
  const logout = useAppStore((state) => state.logout);
  const clearNotice = useAppStore((state) => state.clearNotice);
  const [creating, setCreating] = useState<HarnessId | null>(null);
  const creatingLabel = harnesses.find((item) => item.id === creating)?.label ?? '';

  return (
    <div className="min-h-svh">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
            SERVER-SIDE CONTROL PLANE
          </p>
          <h1 className="text-lg font-semibold">harness-switch</h1>
        </div>
        <Button variant="outline" onClick={() => void logout()}>
          退出
        </Button>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-3">
            <p className="w-fit rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground">
              SSH / HEADLESS
            </p>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
              把 API 路由切换变成一个动作。
            </h2>
            <p className="max-w-2xl text-muted-foreground">
              配置档案按 harness 独立管理。激活后会更新相应配置，并生成可在 SSH shell 中 source
              的环境文件。
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>安全提示</CardTitle>
              <CardDescription>
                API key 仅在服务器本地加密保存，列表和页面不会回显明文。
              </CardDescription>
            </CardHeader>
          </Card>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          {harnesses.map((harness) => (
            <HarnessCard key={harness.id} harness={harness} onAdd={() => setCreating(harness.id)} />
          ))}
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Shell 使用方式</CardTitle>
            <CardDescription>激活后，在运行 harness 的同一个 shell 执行：</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block rounded-md border bg-muted px-3 py-2 text-sm">
              source {envFile || '~/.harness-switch/env.sh'}
            </code>
            <p className="text-sm text-muted-foreground">
              Claude Code 与 Kimi Code 会额外写入各自的原生配置文件；pi、Codex、zcode
              使用统一环境文件，避免覆盖你现有的复杂配置。
            </p>
          </CardContent>
        </Card>
      </main>
      <ProfileDialog
        open={creating !== null}
        harnessId={creating}
        harnessLabel={creatingLabel}
        onOpenChange={(open) => !open && setCreating(null)}
      />
      <Dialog open={notice !== null} onOpenChange={(open) => !open && clearNotice()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>激活成功</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">{notice}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={clearNotice}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
