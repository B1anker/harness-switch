import type { HarnessSummary, PreviewTarget, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { ConfigDiffs, changeKind } from '@/components/config-diff';
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
import { useAppStore } from '@/stores/app-store';

type ActivateDialogProps = {
  harness: HarnessSummary;
  profile: ProfilePublic;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirmation step before activating a profile: fetches the exact content
 * that would be written and shows the diff against the live files.
 */
export function ActivateDialog({ harness, profile, open, onOpenChange }: ActivateDialogProps) {
  const previewProfile = useAppStore((state) => state.previewProfile);
  const activateProfile = useAppStore((state) => state.activateProfile);
  const [targets, setTargets] = useState<PreviewTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setTargets(null);
    setError(null);
    void previewProfile(harness.id, profile.name)
      .then((result) => {
        if (!cancelled) setTargets(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '未知错误');
      });
    return () => {
      cancelled = true;
    };
  }, [open, harness.id, profile.name, previewProfile]);

  const files =
    targets?.map((target) => ({
      path: target.path,
      existed: target.currentContent !== null,
      content: target.content,
      currentContent: target.currentContent,
    })) ?? [];
  const changedCount = files.filter((file) => changeKind(file) !== 'same').length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>激活配置？</AlertDialogTitle>
          <AlertDialogDescription>
            将把 {harness.label} 切换到「{profile.name}」并写入原生配置文件
            {changedCount > 0 ? `，其中 ${changedCount} 个文件将变更` : ''}。写入前会自动备份。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive">无法读取将要写入的内容：{error}</p>
        ) : targets === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在读取将要写入的内容…</p>
        ) : (
          <div className="max-h-[52dvh] overflow-y-auto rounded-xl border p-3">
            <ConfigDiffs files={files} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void activateProfile(harness.id, profile.name);
              onOpenChange(false);
            }}
          >
            确认激活
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
