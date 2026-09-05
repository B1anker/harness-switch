import type { HarnessId, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { HarnessIcon } from '@/components/harness-icon';
import { TabList } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function HarnessTabs({
  harnesses,
  value,
  onChange,
}: {
  harnesses: HarnessSummary[];
  value: HarnessId | undefined;
  onChange: (id: HarnessId) => void;
}) {
  const { t } = useTranslation();

  return (
    <TabList
      label={t('nav.switchHarness')}
      idPrefix="harness"
      orientation="vertical"
      items={harnesses}
      value={value}
      onChange={onChange}
      className="flex gap-2 overflow-x-auto border-b bg-card/45 p-3 xl:sticky xl:top-20 xl:h-[calc(100dvh-80px)] xl:flex-col xl:self-start xl:overflow-x-visible xl:overflow-y-auto xl:border-b-0 xl:border-r xl:p-4"
      tabClassName="min-w-[12rem] gap-3 px-3 py-3 xl:min-w-0 xl:w-full"
    >
      {(harness, selected) => {
        const activeLabel = harness.active?.official
          ? t('harness.official')
          : (harness.active?.name ?? null);
        return (
          <>
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card shadow-[0_4px_12px_-8px_rgb(36_39_70/0.28)]',
                selected ? 'border-primary/20' : 'border-border',
              )}
            >
              <HarnessIcon id={harness.id} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-current">
                {harness.label}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {activeLabel === null
                  ? t('harness.currentInactive')
                  : t('harness.current', { name: activeLabel })}
              </span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {harness.profiles.length}
            </span>
          </>
        );
      }}
    </TabList>
  );
}
