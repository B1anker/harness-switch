import {
  type FavoriteInput,
  favoriteEffortSchema,
  type HarnessId,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { FavoriteSelect } from '../fields';
import { modelGroups } from './model-groups';
import { ToolConnectionPicker } from './tool-connection-picker';

export function ToolBindings({
  draft,
  setDraft,
}: {
  draft: FavoriteInput;
  setDraft: Dispatch<SetStateAction<FavoriteInput>>;
}) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<HarnessId>('claude');
  const binding = draft.toolBindings?.[tool] ?? {};
  const multi = tool === 'kimi' || tool === 'dsh';
  const groups = modelGroups(draft.connections).filter(
    ([connection]) =>
      connection &&
      (multi ||
        tool === 'pi' ||
        connection.protocol === (tool === 'claude' ? 'anthropic-messages' : 'openai-responses')),
  );
  const templateDefault = draft.connections.find(
    (connection) => connection.id === draft.defaultConnectionId,
  );
  const inheritedGroup =
    templateDefault &&
    groups.find((group) => group.some((entry) => entry.id === templateDefault.id));
  const groupId =
    binding.connectionId ?? inheritedGroup?.[0]?.groupId ?? inheritedGroup?.[0]?.id ?? '';
  const group = groups.find(([first]) => (first?.groupId ?? first?.id) === groupId) ?? [];
  const candidates = (multi ? groups.flat() : group).filter((entry) => entry.requestModelId);
  const options = candidates.map((entry) => ({
    value: entry.id,
    label: multi ? `${entry.label} / ${entry.requestModelId}` : entry.requestModelId,
  }));
  const defaultId = binding.defaultModelId ?? draft.defaultConnectionId;
  const defaultModel = candidates.find((entry) => entry.id === defaultId);
  const facts = defaultModel ? resolveFavorite(draft, defaultModel).facts : undefined;
  const supportedEfforts =
    facts?.reasoningSupported === false ? [] : facts?.supportedReasoningEfforts;
  const selectedIds = binding.modelIds ?? candidates.map((entry) => entry.id);
  const change = (patch: Partial<typeof binding>) =>
    setDraft((current) => ({
      ...current,
      toolBindings: {
        ...current.toolBindings,
        [tool]: { ...current.toolBindings?.[tool], ...patch },
      },
    }));
  return (
    <section className="space-y-5" aria-label={t('favorites.scheme.toolSettings')}>
      <div>
        <h3 className="text-lg font-semibold">{t('favorites.scheme.toolSettings')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('favorites.scheme.toolHint')}</p>
      </div>
      <TabList
        idPrefix="template-tools"
        label={t('favorites.scheme.toolSettings')}
        items={(['claude', 'codex', 'kimi', 'dsh'] as const).map((id) => ({ id }))}
        value={tool}
        onChange={(id) => setTool(id as HarnessId)}
        className="flex flex-wrap gap-1 border-b pb-2"
        tabClassName="px-3 py-2 text-sm"
      >
        {(item) => t(`favorites.scheme.tools.${item.id}`)}
      </TabList>
      <TabPanel idPrefix="template-tools" value={tool} className="space-y-5">
        {!multi ? (
          <ToolConnectionPicker
            draft={draft}
            setDraft={setDraft}
            tool={tool}
            groupId={groupId}
            onChange={(connectionId) => {
              const selectedGroup =
                groups.find(([first]) => (first?.groupId ?? first?.id) === connectionId) ?? [];
              change({
                connectionId,
                defaultModelId: selectedGroup.some(
                  (entry) => entry.id === draft.defaultConnectionId,
                )
                  ? undefined
                  : selectedGroup.find((entry) => entry.requestModelId)?.id,
                modelIds: undefined,
                tiers: undefined,
              });
            }}
          />
        ) : null}
        {!candidates.length ? (
          groups.length ? (
            <p className="text-sm text-muted-foreground">{t('favorites.scheme.noCompatible')}</p>
          ) : null
        ) : (
          <>
            {tool === 'claude' ? (
              <>
                <RadioGroup
                  value={binding.mode ?? 'default'}
                  onValueChange={(mode) => change({ mode: mode === 'tiers' ? 'tiers' : 'default' })}
                >
                  {(['default', 'tiers'] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-3 text-sm">
                      <RadioGroupItem value={mode} />
                      {t(`favorites.scheme.${mode}`)}
                    </label>
                  ))}
                </RadioGroup>
                {binding.mode === 'tiers' ? (
                  <div className="space-y-4">
                    {(['opus', 'sonnet', 'haiku'] as const).map((tier) => (
                      <FavoriteSelect
                        key={tier}
                        id={`binding-${tier}`}
                        label={t(`favorites.scheme.tier.${tier}`)}
                        value={binding.tiers?.[tier] ?? ''}
                        placeholder={t('favorites.scheme.chooseModel')}
                        options={options}
                        onChange={(id) => change({ tiers: { ...binding.tiers, [tier]: id } })}
                      />
                    ))}
                    <p className="text-xs text-muted-foreground">
                      {t('favorites.scheme.sameConnection')}
                    </p>
                    <Button
                      variant="link"
                      className="px-0"
                      disabled={!candidates.some((entry) => entry.id === defaultId)}
                      onClick={() =>
                        change({ tiers: { opus: defaultId, sonnet: defaultId, haiku: defaultId } })
                      }
                    >
                      {t('favorites.scheme.allDefault')}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('favorites.scheme.availableModels')}</h4>
                {candidates.map((entry) => (
                  <label key={entry.id} className="flex items-center gap-3 py-1 text-sm">
                    <Checkbox
                      checked={selectedIds.includes(entry.id)}
                      onCheckedChange={(checked) =>
                        change({
                          modelIds: checked
                            ? [...selectedIds, entry.id]
                            : selectedIds.filter((id) => id !== entry.id),
                        })
                      }
                    />
                    <span className="break-all font-mono">
                      {multi ? `${entry.label} / ` : ''}
                      {entry.requestModelId}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <FavoriteSelect
              id={`binding-${tool}-default`}
              label={t('favorites.scheme.startModel')}
              value={binding.defaultModelId ?? 'inherit'}
              options={[
                { value: 'inherit', label: t('favorites.scheme.followTemplate') },
                ...options.filter(
                  (entry) => tool === 'claude' || selectedIds.includes(entry.value),
                ),
              ]}
              onChange={(value) =>
                change({ defaultModelId: value === 'inherit' ? undefined : value })
              }
              error={
                !candidates.some(
                  (entry) =>
                    entry.id === defaultId && (tool === 'claude' || selectedIds.includes(entry.id)),
                )
                  ? t('favorites.scheme.defaultIncompatible')
                  : undefined
              }
            />
            {tool === 'codex' || tool === 'dsh' ? (
              <FavoriteSelect
                id={`binding-${tool}-effort`}
                label={t('favorites.scheme.reasoningEffort')}
                value={binding.reasoningEffort ?? 'inherit'}
                options={[
                  { value: 'inherit', label: t('favorites.scheme.followModel') },
                  ...favoriteEffortSchema.options
                    .filter(
                      (effort) =>
                        supportedEfforts?.includes(effort) || effort === binding.reasoningEffort,
                    )
                    .filter(
                      (effort) =>
                        tool !== 'codex' ||
                        ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort),
                    )
                    .map((value) => ({ value, label: value })),
                ]}
                onChange={(value) =>
                  change({
                    reasoningEffort:
                      value === 'inherit' ? undefined : favoriteEffortSchema.parse(value),
                  })
                }
              />
            ) : null}
          </>
        )}
      </TabPanel>
    </section>
  );
}
