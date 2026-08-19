import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { CircleUserRound, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ActivateDialog } from '@/components/activate-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type HarnessCardProps = {
  harness: HarnessSummary;
  onAdd: () => void;
  onEdit: (profile: ProfilePublic) => void;
  extraActions?: ReactNode;
};

export function HarnessCard({ harness, onAdd, onEdit, extraActions }: HarnessCardProps) {
  const activateOfficial = useAppStore((state) => state.activateOfficial);
  const deleteProfile = useAppStore((state) => state.deleteProfile);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [activating, setActivating] = useState<ProfilePublic | null>(null);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/10">
        <CardContent className="p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)] sm:divide-x">
            <div className="min-w-0 sm:pr-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-primary shadow-[0_0_0_4px_rgb(99_91_255/0.1)]" />
                当前生效配置
              </div>
              <CardTitle className="mt-3 truncate text-xl">
                {harness.active ? `当前激活 · ${harness.active.name}` : '未激活'}
              </CardTitle>
              <CardDescription className="mt-1">
                当前：{harness.active ? harness.active.name : '未激活'}
              </CardDescription>
            </div>
            <div className="min-w-0 sm:pl-5">
              <p className="text-xs text-muted-foreground">写入目标</p>
              <p className="mt-3 truncate font-mono text-sm">
                {harness.targets[0]?.path ?? '未配置目标文件'}
              </p>
              {harness.targets.length > 1 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  以及另外 {harness.targets.length - 1} 个文件
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex items-start gap-3 border-t pt-4 text-sm text-muted-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <p className="pt-1 leading-relaxed">
              配置将直接覆盖目标文件。写入前会自动备份，切换后请验证服务连通性与模型可用性。
            </p>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">配置档案</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {harness.profiles.length} 个自定义配置
            </p>
          </div>
          {extraActions}
        </div>

        <div className="space-y-3">
          {harness.supportsOfficialAuth ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-4 shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <CircleUserRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">官方登录</p>
                    {harness.active?.official ? <Badge variant="secondary">已激活</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {harness.id === 'claude'
                      ? '使用 Claude Code 自身的 Anthropic 账号登录'
                      : '使用 Codex 自身的 ChatGPT / OpenAI 账号登录'}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant={harness.active?.official ? 'secondary' : 'outline'}
                disabled={harness.active?.official}
                onClick={() => void activateOfficial(harness.id)}
              >
                {harness.active?.official ? '已使用' : '切回官方'}
              </Button>
            </div>
          ) : null}
          {harness.profiles.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/60 px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">还没有配置档案</p>
              <Button className="mt-4" size="sm" onClick={onAdd}>
                <Plus />
                新增配置
              </Button>
            </div>
          ) : (
            harness.profiles.map((profile) => {
              const active = harness.active?.name === profile.name;
              return (
                <div
                  key={profile.name}
                  className={cn(
                    'flex flex-col gap-4 rounded-xl border bg-card px-4 py-4 shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)] transition-[border-color,background-color,box-shadow] sm:flex-row sm:items-center sm:justify-between',
                    active
                      ? 'border-primary/20 bg-primary/[0.035] shadow-[0_12px_30px_-24px_rgb(99_91_255/0.35)]'
                      : 'hover:border-primary/15 hover:bg-card/85',
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        'mt-2 size-2 shrink-0 rounded-full',
                        active ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{profile.name}</p>
                        {active ? <Badge>已激活</Badge> : null}
                        {profile.overriddenTargets.length > 0 ? (
                          <Badge variant="outline">手动接管</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {profile.baseUrl}
                      </p>
                      {profile.model ? (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {profile.model}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                    <Button
                      size="sm"
                      variant={active ? 'secondary' : 'outline'}
                      onClick={() => setActivating(profile)}
                    >
                      {!active ? <Play /> : null}
                      {active ? '已激活' : '激活'}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`编辑 ${profile.name}`}
                      onClick={() => onEdit(profile)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除 ${profile.name}`}
                      disabled={active}
                      title={active ? '先激活另一个配置，才能删除当前配置' : undefined}
                      onClick={() => setPendingName(profile.name)}
                    >
                      <Trash2 className={active ? undefined : 'text-destructive'} />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
      {activating ? (
        <ActivateDialog
          harness={harness}
          profile={activating}
          open
          onOpenChange={(open) => !open && setActivating(null)}
        />
      ) : null}
      <AlertDialog
        open={pendingName !== null}
        onOpenChange={(open) => !open && setPendingName(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除配置？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {harness.label} / {pendingName}。
              {harness.mode === 'additive' ? '它在配置文件里的 provider 条目也会被一并摘掉。' : ''}
              此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingName) {
                  void deleteProfile(harness.id, pendingName);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
