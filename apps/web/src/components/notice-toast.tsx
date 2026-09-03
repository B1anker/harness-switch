import { useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

/**
 * Fires a Sonner toast per pending notice line, then clears the queue. Lines stay
 * catalog keys until here because the store has no `t`; the trade-off versus the old
 * hand-rolled toast is that a fired toast no longer follows a language switch.
 */
export function NoticeToast() {
  const { t } = useTranslation();
  const notice = useAppStore((state) => state.notice);
  const clearNotice = useAppStore((state) => state.clearNotice);

  useEffect(() => {
    if (!notice) {
      return;
    }
    for (const line of notice) {
      const text = lineText(t, line);
      if (line.key.startsWith('warning.')) {
        toast.warning(text);
      } else {
        toast.success(text);
      }
    }
    clearNotice();
  }, [notice, clearNotice, t]);

  return <Toaster position="top-center" richColors />;
}
