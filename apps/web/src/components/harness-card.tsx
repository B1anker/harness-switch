import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/stores/app-store';

type HarnessCardProps = {
  harness: HarnessSummary;
  onAdd: () => void;
  onEdit: (profile: ProfilePublic) => void;
};

export function HarnessCard({ harness, onAdd, onEdit }: HarnessCardProps) {
  const activateProfile = useAppStore((state) => state.activateProfile);
  const deleteProfile = useAppStore((state) => state.deleteProfile);
  const [pendingName, setPendingName] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
            {harness.id.toUpperCase()}
          </p>
          <CardTitle>{harness.label}</CardTitle>
          <CardDescription>当前：{harness.active ? harness.active.name : '未激活'}</CardDescription>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus />
          新增
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {harness.profiles.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">还没有配置档案</p>
        ) : (
          harness.profiles.map((profile, index) => {
            const active = harness.active?.name === profile.name;
            return (
              <div key={profile.name}>
                {index > 0 ? <Separator className="mb-3" /> : null}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{profile.name}</p>
                      {active ? <Badge variant="secondary">已激活</Badge> : null}
                      {profile.overriddenTargets.length > 0 ? (
                        <Badge variant="outline">手动接管</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{profile.baseUrl}</p>
                    {profile.model ? (
                      <p className="text-xs text-muted-foreground">{profile.model}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant={active ? 'secondary' : 'default'}
                      onClick={() => activateProfile(harness.id, profile.name)}
                    >
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
              </div>
            );
          })
        )}
      </CardContent>
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
    </Card>
  );
}
