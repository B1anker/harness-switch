import type { FavoriteInput } from '@seaveyon/harness-switch-shared';
import type { Dispatch, SetStateAction } from 'react';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { TabList } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';

export function EditorHeader({
  editing,
  draft,
  setDraft,
  tab,
  setTab,
  busy,
  error,
}: {
  editing: boolean;
  draft: FavoriteInput;
  setDraft: Dispatch<SetStateAction<FavoriteInput>>;
  tab: string;
  setTab(value: string): void;
  busy: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <DialogTitle>{t(editing ? 'favorites.edit' : 'favorites.add')}</DialogTitle>
        <FormField
          id="favorite-name"
          label={t('favorites.name')}
          labelClassName="sr-only"
          className="w-64 max-w-full"
          error={error}
        >
          {(control) => (
            <Input
              {...control}
              disabled={busy}
              maxLength={120}
              placeholder={draft.connections[0]?.requestModelId || t('favorites.autoName')}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          )}
        </FormField>
        <TabList
          idPrefix="favorite-editor"
          label={t('favorites.editorSections')}
          items={[{ id: 'connections' }, { id: 'capabilities' }]}
          value={tab}
          onChange={setTab}
          className="flex gap-1 sm:ml-auto"
          tabClassName="px-3 py-2 text-sm font-medium"
        >
          {(item) =>
            t(item.id === 'connections' ? 'favorites.connectionTab' : 'favorites.capabilitiesTab')
          }
        </TabList>
      </div>
      <DialogDescription>{t('favorites.scheme.editorHint')}</DialogDescription>
    </DialogHeader>
  );
}
