import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { ChevronDown, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { modelGroups } from './model-groups';

export function ModelSelectionGroups({
  connections,
  selectedIds,
  onChange,
}: {
  connections: FavoriteConnection[];
  selectedIds: string[];
  onChange(ids: string[]): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const groups = modelGroups(connections);
  const needle = query.trim().toLowerCase();
  const setEntries = (entries: FavoriteConnection[], selected: boolean) => {
    const next = new Set(selectedIds);
    for (const entry of entries) {
      if (selected) {
        next.add(entry.id);
      } else {
        next.delete(entry.id);
      }
    }
    onChange([...next]);
  };
  const toggleEntry = (entry: FavoriteConnection) => {
    const next = new Set(selectedIds);
    if (next.has(entry.id)) {
      next.delete(entry.id);
    } else {
      next.add(entry.id);
    }
    onChange([...next]);
  };
  const visibleGroups = groups
    .map((group, index) => {
      const entries = group.filter((entry) =>
        `${entry.label} ${entry.requestModelId}`.toLowerCase().includes(needle),
      );
      return { group, index, entries };
    })
    .filter((entry) => entry.entries.length > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h4 className="text-sm font-medium">{t('favorites.scheme.availableModels')}</h4>
        <p className="text-xs text-muted-foreground">
          {t('favorites.scheme.groupSelectionCount', {
            selected: selectedIds.filter((id) => connections.some((entry) => entry.id === id))
              .length,
            count: connections.length,
          })}
        </p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t('favorites.scheme.searchModels')}
          placeholder={t('favorites.scheme.searchModels')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>
      {query ? (
        <p className="text-xs text-muted-foreground">
          {t('favorites.scheme.filteredSelectionHint')}
        </p>
      ) : null}
      {!visibleGroups.length ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {t('workspace.noMatches')}
        </p>
      ) : null}
      {visibleGroups.map(({ group, index, entries }) => (
        <ModelGroupCard
          key={group[0]!.groupId ?? group[0]!.id}
          title={group[0]!.label || t('favorites.channelNumber', { count: index + 1 })}
          group={group}
          entries={entries}
          selectedIds={selectedIds}
          defaultOpen={groups.length === 1}
          forceOpen={!!needle}
          onCheckAll={(checked) => setEntries(entries, checked)}
          onToggle={toggleEntry}
        />
      ))}
    </div>
  );
}

function ModelGroupCard({
  title,
  group,
  entries,
  selectedIds,
  defaultOpen,
  forceOpen,
  onCheckAll,
  onToggle,
}: {
  title: string;
  group: FavoriteConnection[];
  entries: FavoriteConnection[];
  selectedIds: string[];
  defaultOpen: boolean;
  forceOpen: boolean;
  onCheckAll(checked: boolean): void;
  onToggle(entry: FavoriteConnection): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const expanded = open || forceOpen;
  const selectedInGroup = group.filter((entry) => selectedIds.includes(entry.id)).length;
  const selectedVisible = entries.filter((entry) => selectedIds.includes(entry.id)).length;
  const checkAllState =
    selectedVisible === 0 ? false : selectedVisible === entries.length ? true : 'indeterminate';
  const showProtocol = new Set(entries.map((entry) => entry.protocol).filter(Boolean)).size > 1;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_-26px_rgb(36_39_70/0.38)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-muted/35 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="min-w-0 truncate text-sm font-semibold text-primary">{title}</span>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {t('favorites.scheme.groupSelectionCount', {
            selected: selectedInGroup,
            count: group.length,
          })}
        </Badge>
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div id={panelId} hidden={!expanded} className="px-3 pb-3 pt-1">
        <label className="flex cursor-pointer items-center gap-3 px-1 py-2.5 text-sm font-medium">
          <Checkbox
            checked={checkAllState}
            onCheckedChange={(checked) => onCheckAll(checked === true)}
          />
          {t('favorites.scheme.selection.all')}
        </label>
        <div className="border-t" />
        <div className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain pt-1">
          {entries.map((entry) => {
            const checked = selectedIds.includes(entry.id);
            return (
              <label
                key={entry.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm transition-colors hover:bg-muted/40',
                  checked && 'bg-primary/[0.04]',
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => onToggle(entry)} />
                <span className="min-w-0 flex-1">
                  <span className="block break-all font-mono text-[13px] leading-5">
                    {entry.requestModelId}
                  </span>
                  {showProtocol && entry.protocol ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {entry.protocol}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}
