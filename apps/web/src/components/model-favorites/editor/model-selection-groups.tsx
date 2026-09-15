import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
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
  const bulk = (entries: FavoriteConnection[], action: 'all' | 'none' | 'invert') => {
    const next = new Set(selectedIds);
    for (const entry of entries) {
      if (action === 'all' || (action === 'invert' && !selectedIds.includes(entry.id))) {
        next.add(entry.id);
      } else {
        next.delete(entry.id);
      }
    }
    onChange([...next]);
  };
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">{t('favorites.scheme.availableModels')}</h4>
      <Input
        aria-label={t('favorites.scheme.searchModels')}
        placeholder={t('favorites.scheme.searchModels')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query ? (
        <p className="text-xs text-muted-foreground">
          {t('favorites.scheme.filteredSelectionHint')}
        </p>
      ) : null}
      {groups.map((group, index) => {
        const entries = group.filter((entry) =>
          `${entry.label} ${entry.requestModelId}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        );
        if (!entries.length) {
          return null;
        }
        return (
          <div key={group[0]!.groupId ?? group[0]!.id} className="rounded-xl border p-3">
            <Disclosure
              title={group[0]!.label || t('favorites.channelNumber', { count: index + 1 })}
              summary={t('favorites.scheme.groupSelectionCount', {
                selected: group.filter((entry) => selectedIds.includes(entry.id)).length,
                count: group.length,
              })}
              defaultOpen={groups.length === 1}
              forceOpen={!!query.trim()}
              triggerClassName="h-auto w-full flex-wrap justify-start whitespace-normal px-0 text-left"
            >
              <div className="flex flex-wrap gap-1">
                {(['all', 'none', 'invert'] as const).map((action) => (
                  <Button
                    key={action}
                    variant="ghost"
                    size="sm"
                    onClick={() => bulk(entries, action)}
                  >
                    {t(`favorites.scheme.selection.${action}`)}
                  </Button>
                ))}
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1">
                {entries.map((entry) => (
                  <label key={entry.id} className="flex items-start gap-3 py-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedIds.includes(entry.id)}
                      onCheckedChange={() => bulk([entry], 'invert')}
                    />
                    <span className="min-w-0 break-all font-mono">{entry.requestModelId}</span>
                  </label>
                ))}
              </div>
            </Disclosure>
          </div>
        );
      })}
    </div>
  );
}
