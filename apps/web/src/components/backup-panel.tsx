import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/stores/app-store';

export function BackupPanel() {
  const backups = useAppStore((state) => state.backups);
  const loadBackups = useAppStore((state) => state.loadBackups);
  const restoreBackup = useAppStore((state) => state.restoreBackup);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" />
          配置备份
        </CardTitle>
        <CardDescription>
          每次写入前都会把原文件快照到数据目录，保留最近 10 份。恢复会把当时的文件原样写回，包括
          注释和排版。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {backups.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">还没有备份</p>
        ) : (
          backups.map((backup, index) => (
            <div key={backup.id}>
              {index > 0 ? <Separator className="mb-3" /> : null}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {backup.harness} / {backup.profile}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(backup.createdAt).toLocaleString()}
                  </p>
                  {backup.files.map((file) => (
                    <p key={file.path} className="truncate font-mono text-xs text-muted-foreground">
                      {file.path}
                      {file.existed ? '' : '（当时不存在，恢复会删除）'}
                    </p>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setPendingId(backup.id)}
                >
                  恢复
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
      <AlertDialog open={pendingId !== null} onOpenChange={(open) => !open && setPendingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复这份备份？</AlertDialogTitle>
            <AlertDialogDescription>
              会用备份内容覆盖对应的原生配置文件，当前内容将丢失。harness-switch
              记录的「当前激活」不会随之回退。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingId) {
                  void restoreBackup(pendingId);
                }
              }}
            >
              恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
