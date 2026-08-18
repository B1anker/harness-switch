import type { HarnessId, HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
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
import { cn } from '@/lib/utils';
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
  const [selectedHarnessId, setSelectedHarnessId] = useState<HarnessId>('claude');
  const editingHarness = harnesses.find((item) => item.id === editing?.harnessId);
  const selectedHarness = harnesses.find((item) => item.id === selectedHarnessId) ?? harnesses[0];

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
        <section className="space-y-4">
          <HarnessTabs
            harnesses={harnesses}
            value={selectedHarness?.id}
            onChange={setSelectedHarnessId}
          />
          {selectedHarness ? (
            <div
              role="tabpanel"
              id={`harness-panel-${selectedHarness.id}`}
              aria-labelledby={`harness-tab-${selectedHarness.id}`}
            >
              <HarnessCard
                harness={selectedHarness}
                extraActions={<BackupPanel harnessId={selectedHarness.id} />}
                onAdd={() => setEditing({ harnessId: selectedHarness.id, profile: null })}
                onEdit={(profile) => setEditing({ harnessId: selectedHarness.id, profile })}
              />
            </div>
          ) : null}
        </section>
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
              文件里只会写入对应工具确实认识的变量。Kimi Code 与 Pi 不从 shell
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

function HarnessTabs({
  harnesses,
  value,
  onChange,
}: {
  harnesses: HarnessSummary[];
  value: HarnessId | undefined;
  onChange: (id: HarnessId) => void;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + offset + harnesses.length) % harnesses.length;
    const next = harnesses[nextIndex];
    if (next) {
      onChange(next.id);
      const tabs =
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs?.[nextIndex]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label="切换 Harness"
      className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/50 p-1.5 md:grid-cols-5"
    >
      {harnesses.map((harness, index) => {
        const selected = harness.id === value;
        return (
          <button
            key={harness.id}
            type="button"
            role="tab"
            id={`harness-tab-${harness.id}`}
            aria-controls={`harness-panel-${harness.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(harness.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[color,background-color,box-shadow,transform] hover:bg-background/70 active:translate-y-px',
              selected
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-[11px] font-bold uppercase transition-colors',
                selected && 'border-primary/30 bg-primary text-primary-foreground',
              )}
            >
              {tabMark(harness.id)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-current">
                {harness.label}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {harness.active ? `当前：${harness.active.name}` : '当前：未激活'}
              </span>
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
              {harness.profiles.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function tabMark(id: HarnessId): string {
  const marks: Record<HarnessId, string> = {
    claude: 'CL',
    codex: 'CX',
    kimi: 'KM',
    pi: 'PI',
    dsh: 'DS',
  };
  return marks[id];
}
