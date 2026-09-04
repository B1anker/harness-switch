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
import { TabList, TabPanel } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';

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
 *
 * Height is fixed so switching sources does not resize the shell; each pane scrolls inside.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(90dvh,40rem)] sm:max-h-[90dvh] sm:w-full">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>{t('transfer.intro')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]">
          <TabList
            label={t('transfer.sourceLabel')}
            idPrefix="transfer"
            orientation="vertical"
            items={SOURCES}
            value={source}
            onChange={setSource}
            className="flex gap-2 overflow-x-auto border-b bg-card/45 p-3 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r"
            tabClassName="gap-2.5 px-3 py-2.5 text-sm sm:w-full"
          >
            {(item) => (
              <>
                <item.icon className="size-4 shrink-0" />
                <span className="whitespace-nowrap font-medium sm:whitespace-normal">
                  {t(`transfer.sources.${item.id}`)}
                </span>
              </>
            )}
          </TabList>

          <TabPanel
            idPrefix="transfer"
            value={source}
            className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6"
          >
            {source === 'scan' ? <ScanPane /> : null}
            {source === 'user' ? <UserPane onDone={() => onOpenChange(false)} /> : null}
            {source === 'file' ? <FilePane onDone={() => onOpenChange(false)} /> : null}
            {source === 'gist' ? <GistPane onDone={() => onOpenChange(false)} /> : null}
          </TabPanel>
        </div>
      </DialogContent>
    </Dialog>
  );
}
