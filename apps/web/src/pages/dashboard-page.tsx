import type { HarnessId, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { BackupPanel } from '@/components/backup-panel';
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

type Editing = {
  harnessId: HarnessId;
  profile: ProfilePublic | null;
};

export function DashboardPage() {
  const harnesses = useAppStore((state) => state.harnesses);
  const envFile = useAppStore((state) => state.envFile);
  const notice = useAppStore((state) => state.notice);
  const logout = useAppStore((state) => state.logout);
  const clearNotice = useAppStore((state) => state.clearNotice);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingHarness = harnesses.find((item) => item.id === editing?.harnessId);

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
              激活时直接写入各工具自己的配置文件，因此常驻进程 spawn 出来的 CLI
              也能拿到新配置，不依赖你在某个 shell 里 source 过什么。
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>安全提示</CardTitle>
              <CardDescription>
                API key
                在服务器本地加密保存，列表不会回显明文；写入原生配置文件时会保留文件原有权限。
              </CardDescription>
            </CardHeader>
          </Card>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          {harnesses.map((harness) => (
            <HarnessCard
              key={harness.id}
              harness={harness}
              onAdd={() => setEditing({ harnessId: harness.id, profile: null })}
              onEdit={(profile) => setEditing({ harnessId: harness.id, profile })}
            />
          ))}
        </section>
        <BackupPanel />
        <Card>
          <CardHeader>
            <CardTitle>环境文件（兼容层）</CardTitle>
            <CardDescription>
              切换本身不需要它。只有 Codex 选择「环境变量」认证方式时才需要在对应 shell 执行：
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block rounded-md border bg-muted px-3 py-2 text-sm">
              source {envFile || '~/.harness-switch/env.sh'}
            </code>
            <p className="text-sm text-muted-foreground">
              文件里只会写入对应工具确实认识的变量。Kimi Code 与 oh-my-pi 不从 shell
              读取凭据，所以它们只有一行注释。
            </p>
          </CardContent>
        </Card>
      </main>
      {editing && editingHarness ? (
        <ProfileDialog
          key={`${editing.harnessId}-${editing.profile?.name ?? 'new'}`}
          harness={editingHarness}
          profile={editing.profile}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      <Dialog open={notice !== null} onOpenChange={(open) => !open && clearNotice()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>操作完成</DialogTitle>
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
