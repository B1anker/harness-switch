import type { LucideIcon } from 'lucide-react';
import { Cloud, FileLock2, FileSearch, Users } from 'lucide-react';
import { useState } from 'react';
import { FilePane } from '@/components/transfer/file-pane';
import { GistPane } from '@/components/transfer/gist-pane';
import { ScanPane } from '@/components/transfer/scan-pane';
import { UserPane } from '@/components/transfer/user-pane';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Where configuration is coming from. Every source ends in this manager's own store. */
const SOURCES = [
  { id: 'scan', icon: FileSearch },
  { id: 'user', icon: Users },
  { id: 'file', icon: FileLock2 },
  { id: 'gist', icon: Cloud },
] as const satisfies ReadonlyArray<{ id: string; icon: LucideIcon }>;

type SourceId = (typeof SOURCES)[number]['id'];

/**
 * One entry point for every way configuration gets moved in or out.
 *
 * These were four separate header buttons, which read as four features when they are one:
 * the same profiles and credentials arriving from a different place. The rail names the
 * source; the pane owns the flow, because the sources genuinely differ — the two local
 * ones decide conflicts per item, while the two portable ones share `TransferPreview` and
 * one global policy.
 */
export function ConfigTransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<SourceId>('scan');

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (!backward && !forward && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = SOURCES.length - 1;
    } else {
      nextIndex = (index + (forward ? 1 : -1) + SOURCES.length) % SOURCES.length;
    }
    setSource(SOURCES[nextIndex]!.id);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:w-full">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>{t('transfer.intro')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <div
            role="tablist"
            aria-label={t('transfer.sourceLabel')}
            aria-orientation="vertical"
            className="flex gap-2 overflow-x-auto border-b bg-card/45 p-3 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r"
          >
            {SOURCES.map((item, index) => {
              const selected = item.id === source;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`transfer-tab-${item.id}`}
                  aria-controls={`transfer-panel-${item.id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setSource(item.id)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-[color,background-color,box-shadow,transform] duration-150 active:translate-y-px sm:w-full',
                    selected
                      ? 'bg-primary/[0.09] text-primary shadow-[inset_0_0_0_1px_rgb(99_91_255/0.13)]'
                      : 'text-muted-foreground hover:bg-card hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="whitespace-nowrap font-medium sm:whitespace-normal">
                    {t(`transfer.sources.${item.id}`)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`transfer-panel-${source}`}
            aria-labelledby={`transfer-tab-${source}`}
            className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6"
          >
            {source === 'scan' ? <ScanPane /> : null}
            {source === 'user' ? <UserPane onDone={() => onOpenChange(false)} /> : null}
            {source === 'file' ? <FilePane onDone={() => onOpenChange(false)} /> : null}
            {source === 'gist' ? <GistPane onDone={() => onOpenChange(false)} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
