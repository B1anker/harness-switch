import {
  type FavoriteConnection,
  type FavoriteInput,
  type ModelFacts,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/app-store';
import { type InferredFacts, updateConnectionFacts } from '../draft-facts';
import { presetProtocolForUrl } from '../preset-connections';

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
  const [draft, setDraft] = useState<FavoriteInput>(
    initialDraft ?? {
      name: '',
      notes: '',
      defaults: {},
      preferences: {},
      connections: [],
    },
  );
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
      const result = updateConnectionFacts(
        current,
        vaultTarget,
        {
          providerId: created.id,
          endpointKey,
          ...(protocol ? { protocol } : {}),
        },
        inferred.current,
      );
      inferred.current = result.inferred;
      return result.draft;
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
      const hint = !modelHints || candidates?.includes(model) ? hintFacts?.[model] : undefined;
      const result = updateConnectionFacts(current, id, patch, inferred.current, hint);
      inferred.current = result.inferred;
      return result.draft;
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
    inferredFacts: inferred.current,
    dirty: JSON.stringify(draft) !== baseline.current,
  };
}
