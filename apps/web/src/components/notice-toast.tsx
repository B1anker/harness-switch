import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';

export function NoticeToast() {
  const notice = useAppStore((state) => state.notice);
  const clearNotice = useAppStore((state) => state.clearNotice);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => clearNotice(), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  if (!notice) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-[0_18px_50px_-24px_rgb(36_39_70/0.45)]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">已写入磁盘</p>
        <Button size="sm" variant="ghost" onClick={clearNotice}>
          关闭
        </Button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        {notice}
      </p>
    </div>
  );
}
