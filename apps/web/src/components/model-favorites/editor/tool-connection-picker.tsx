import type { FavoriteInput, HarnessId } from '@seaveyon/harness-switch-shared';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { FavoriteSelect } from '../fields';
import { modelGroups } from './model-groups';

export function ToolConnectionPicker({
  draft,
  setDraft,
  tool,
  groupId,
  onChange,
}: {
  draft: FavoriteInput;
  setDraft: Dispatch<SetStateAction<FavoriteInput>>;
  tool: HarnessId;
  groupId: string;
  onChange(id: string): void;
}) {
  const { t } = useTranslation();
  const protocol: FavoriteInput['connections'][number]['protocol'] =
    tool === 'codex' ? 'openai-responses' : 'anthropic-messages';
  const groups = modelGroups(draft.connections);
  const compatible = groups.filter(([first]) => first?.protocol === protocol);
  if (compatible.length) {
    return (
      <FavoriteSelect
        id={`binding-${tool}-connection`}
        label={t('favorites.scheme.useConnection')}
        value={groupId}
        options={compatible.map(([first]) => ({
          value: first!.groupId ?? first!.id,
          label: first!.label || first!.requestModelId,
        }))}
        placeholder={t('favorites.scheme.chooseConnection')}
        onChange={onChange}
      />
    );
  }
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">
        {t('favorites.scheme.protocolRequired', {
          tool: t(`favorites.scheme.tools.${tool}`),
          protocol,
        })}
      </p>
      {groups
        .filter((group) => group[0]?.providerId && group.some((entry) => entry.requestModelId))
        .map((group) => (
          <Button
            key={group[0]!.id}
            variant="outline"
            className="h-auto max-w-full whitespace-normal text-left"
            onClick={() => {
              const id = crypto.randomUUID();
              const copies = group
                .filter((entry) => entry.requestModelId)
                .map((entry) => ({
                  ...entry,
                  id: crypto.randomUUID(),
                  groupId: id,
                  protocol,
                  label: `${entry.label} · ${tool}`,
                }));
              setDraft((current) => ({
                ...current,
                connections: [...current.connections, ...copies],
                toolBindings: {
                  ...current.toolBindings,
                  [tool]: { connectionId: id, defaultModelId: copies[0]!.id },
                },
              }));
            }}
          >
            {t('favorites.scheme.addProtocolConnection', {
              name: group[0]!.label || group[0]!.requestModelId,
              tool: t(`favorites.scheme.tools.${tool}`),
            })}
          </Button>
        ))}
      <p className="text-xs text-muted-foreground">
        {t('favorites.scheme.protocolConnectionHint')}
      </p>
    </div>
  );
}
