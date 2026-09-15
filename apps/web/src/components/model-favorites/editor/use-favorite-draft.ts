import {
  type FavoriteConnection,
  type FavoriteInput,
  type ModelFacts,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/app-store';
import { type InferredFacts, NEW_TEMPLATE_FACTS, updateConnectionFacts } from '../draft-facts';
import { presetFactsForConnection, presetProtocolForUrl } from '../preset-connections';
import { selectGroupModels } from './model-groups';

function emptyConnection(providerId = '', endpointKey = ''): FavoriteConnection {
  return {
    id: crypto.randomUUID(),
    label: '',
    providerId,
    endpointKey,
    protocol: 'openai-responses',
    requestModelId: '',
    factOverrides: {},
    preferenceOverrides: {},
  };
}

export function useFavoriteDraft(
  initialDraft?: FavoriteInput,
  modelHints?: Record<string, string[]>,
  hintFacts?: Record<string, ModelFacts>,
) {
  const providerList = useAppStore((state) => state.providers);
  const providers = providerList ?? [];
  const [draft, setDraft] = useState<FavoriteInput>(() => {
    const source = initialDraft ?? {
      name: '',
      notes: '',
      defaults: {},
      preferences: {},
      connections: [],
    };
    return {
      ...source,
      defaultConnectionId:
        source.defaultConnectionId ??
        source.connections.find((connection) => connection.requestModelId)?.id,
      defaults: {
        ...source.defaults,
        contextWindow: source.defaults.contextWindow ?? NEW_TEMPLATE_FACTS.contextWindow,
        maxOutputTokens: source.defaults.maxOutputTokens ?? NEW_TEMPLATE_FACTS.maxOutputTokens,
        reasoningSupported:
          source.defaults.reasoningSupported ?? NEW_TEMPLATE_FACTS.reasoningSupported,
      },
    };
  });
  const baseline = useRef(JSON.stringify(draft));
  const inferred = useRef<InferredFacts>({});
  /**
   * Which channel asked for a new vault entry: a connection id, null for "append a new
   * channel", undefined for "vault closed". The baseline lets the effect below spot the
   * entry the user just created and select it.
   */
  const [vaultTarget, setVaultTarget] = useState<string | null | undefined>(undefined);
  const vaultBaseline = useRef<string[]>([]);
  const openVault = (target: string | null) => {
    vaultBaseline.current = providers.map((provider) => provider.id);
    setVaultTarget(target);
  };
  useEffect(() => {
    if (vaultTarget === undefined) {
      return;
    }
    const created = providerList?.find((provider) => !vaultBaseline.current.includes(provider.id));
    if (!created) {
      return;
    }
    const endpoint = created.endpoints[0];
    const endpointKey = endpoint?.key ?? '';
    const protocol = endpoint ? presetProtocolForUrl(endpoint.baseUrl) : undefined;
    setDraft((current) => {
      if (vaultTarget === null) {
        return {
          ...current,
          connections: [
            ...current.connections,
            { ...emptyConnection(created.id, endpointKey), ...(protocol ? { protocol } : {}) },
          ],
        };
      }
      const target = current.connections.find((entry) => entry.id === vaultTarget);
      let next = current;
      for (const entry of current.connections.filter(
        (candidate) => (candidate.groupId ?? candidate.id) === (target?.groupId ?? target?.id),
      )) {
        const result = updateConnectionFacts(
          next,
          entry.id,
          {
            providerId: created.id,
            endpointKey,
            ...(protocol ? { protocol } : {}),
          },
          inferred.current,
        );
        inferred.current = result.inferred;
        next = result.draft;
      }
      return next;
    });
    setVaultTarget(undefined);
  }, [providerList, vaultTarget]);
  const addConnection = () =>
    setDraft((current) => ({
      ...current,
      connections: [...current.connections, emptyConnection()],
    }));
  const update = (id: string, patch: Partial<FavoriteConnection>) =>
    setDraft((current) => {
      const connection = current.connections.find((item) => item.id === id);
      const updated = { ...connection, ...patch };
      const model = updated.requestModelId ?? '';
      const candidates = modelHints?.[`${updated.providerId}/${updated.endpointKey}`];
      const hint =
        (!modelHints || candidates?.includes(model) ? hintFacts?.[model] : undefined) ??
        (updated.providerId && updated.endpointKey
          ? presetFactsForConnection(providers, updated.providerId, updated.endpointKey, model)
          : undefined);
      const result = updateConnectionFacts(current, id, patch, inferred.current, hint);
      inferred.current = result.inferred;
      return result.draft;
    });
  const selectModels = (group: FavoriteConnection[], models: string[]) =>
    setDraft((current) => {
      let next = selectGroupModels(current, group, models);
      for (const connection of next.connections) {
        if (
          !connection.requestModelId ||
          current.connections.some(
            (entry) =>
              entry.id === connection.id && entry.requestModelId === connection.requestModelId,
          )
        ) {
          continue;
        }
        const candidates = modelHints?.[`${connection.providerId}/${connection.endpointKey}`];
        const hint =
          (!modelHints || candidates?.includes(connection.requestModelId)
            ? hintFacts?.[connection.requestModelId]
            : undefined) ??
          presetFactsForConnection(
            providers,
            connection.providerId,
            connection.endpointKey,
            connection.requestModelId,
          );
        const before = {
          ...next,
          connections: next.connections.map((entry) =>
            entry.id === connection.id ? { ...entry, requestModelId: '' } : entry,
          ),
        };
        const result = updateConnectionFacts(
          before,
          connection.id,
          { requestModelId: connection.requestModelId },
          inferred.current,
          hint,
        );
        next = result.draft;
        inferred.current = result.inferred;
      }
      return next;
    });
  return {
    draft,
    setDraft,
    providers,
    vaultTarget,
    setVaultTarget,
    openVault,
    addConnection,
    update,
    selectModels,
    inferredFacts: inferred.current,
    dirty: JSON.stringify(draft) !== baseline.current,
  };
}
