import {
  createFavoriteRequestSchema,
  type FavoriteConnection,
  type FavoriteInput,
  favoriteEffortSchema,
  type ModelFacts,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { isCrossFieldIssue, locateFavoriteIssues } from '@/lib/favorite-validation';
import { formatTokens } from '@/lib/format-tokens';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { ConnectionCard } from './connection-card';
import { FavoriteFacts } from './fields';
import { SUGGESTED_FACTS } from './suggested-defaults';

export type FavoriteSaveNext = 'configure' | 'review' | null;

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

/** The candidate payload: empty name/labels fall back to the model and provider names. */
function favoritePayload(draft: FavoriteInput, providers: { id: string; name: string }[]) {
  return {
    ...draft,
    name: draft.name || draft.connections[0]?.requestModelId,
    connections: draft.connections.map((connection) => ({
      ...connection,
      label:
        connection.label ||
        providers.find((provider) => provider.id === connection.providerId)?.name ||
        connection.requestModelId,
    })),
  };
}

export function FavoriteEditor({
  favorite,
  initialDraft,
  modelHints,
  hintFacts,
  onClose,
  onSaved,
}: {
  favorite?: FavoriteListItem;
  /** Starting draft for the preset and clone flows; ignored when editing. */
  initialDraft?: FavoriteInput;
  /** Curated model candidates per `providerId/endpointKey`, merged with the live catalog. */
  modelHints?: Record<string, string[]>;
  /** Curated capability defaults per model id, applied when the model is chosen. */
  hintFacts?: Record<string, ModelFacts>;
  onClose(): void;
  /** Toast primary action: open the apply wizard or jump to the relationship view. */
  onSaved?(saved: ModelFavorite, next: FavoriteSaveNext): void;
}) {
  const { t } = useTranslation();
  const providerList = useAppStore((state) => state.providers);
  const providers = providerList ?? [];
  const save = useAppStore((state) => state.saveFavorite);
  const loadCatalog = useAppStore((state) => state.loadFavoriteCatalog);
  const setNotice = useAppStore((state) => state.setNotice);
  const [draft, setDraft] = useState<FavoriteInput>(
    favorite ??
      initialDraft ?? {
        name: '',
        notes: '',
        defaults: { ...SUGGESTED_FACTS },
        preferences: {},
        connections: [],
      },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
    const endpointKey = created.endpoints[0]?.key ?? '';
    setDraft((current) =>
      vaultTarget === null
        ? {
            ...current,
            connections: [...current.connections, emptyConnection(created.id, endpointKey)],
          }
        : {
            ...current,
            connections: current.connections.map((connection) =>
              connection.id === vaultTarget
                ? { ...connection, providerId: created.id, endpointKey }
                : connection,
            ),
          },
    );
    setVaultTarget(undefined);
  }, [providerList, vaultTarget]);
  const addConnection = () =>
    setDraft((current) => ({
      ...current,
      connections: [...current.connections, emptyConnection()],
    }));
  // Cross-field rules surface as the fields change; plain field errors wait for a save
  // attempt so an untouched form does not light up red.
  const parsed = createFavoriteRequestSchema.safeParse(favoritePayload(draft, providers));
  const located = parsed.success
    ? { fields: {}, cards: {}, global: [] }
    : locateFavoriteIssues(
        draft,
        parsed.error.issues.filter((issue) => submitted || isCrossFieldIssue(issue)),
      );
  const fieldErrors = Object.fromEntries(
    Object.entries(located.fields).map(([fieldId, key]) => [fieldId, t(key)]),
  );
  const cardErrors = Object.fromEntries(
    Object.entries(located.cards).map(([id, key]) => [id, t(key)]),
  );
  const advancedError = Object.keys(located.fields).some(
    (fieldId) => fieldId.startsWith('favorite-') && fieldId !== 'favorite-name',
  );
  const defaultsSummary = [
    draft.defaults.contextWindow &&
      `${t('favorites.contextWindow')} ${formatTokens(draft.defaults.contextWindow)}`,
    draft.defaults.maxOutputTokens &&
      `${t('favorites.maxOutputTokens')} ${formatTokens(draft.defaults.maxOutputTokens)}`,
    draft.defaults.reasoningSupported !== undefined &&
      `${t('favorites.reasoningSupported')} ${t(`favorites.${draft.defaults.reasoningSupported}`)}`,
    draft.defaults.supportedReasoningEfforts?.length &&
      `${t('favorites.supportedReasoningEfforts')} ${draft.defaults.supportedReasoningEfforts.join(', ')}`,
    draft.preferences.reasoningEffort &&
      `${t('favorites.reasoningEffort')} ${draft.preferences.reasoningEffort}`,
  ].filter(Boolean);
  const advancedSummary = defaultsSummary.length
    ? t('favorites.advancedSummary', { value: defaultsSummary.join(' · ') })
    : undefined;
  const update = (id: string, patch: Partial<FavoriteConnection>) =>
    setDraft((current) => {
      const connections = current.connections.map((connection) =>
        connection.id === id ? { ...connection, ...patch } : connection,
      );
      // Choosing a curated candidate adopts its declared capabilities as the defaults.
      const hinted = patch.requestModelId ? hintFacts?.[patch.requestModelId] : undefined;
      return hinted
        ? { ...current, connections, defaults: { ...hinted } }
        : { ...current, connections };
    });
  /** Post-save connectivity probe per channel; failures warn, never block the save. */
  const probeSaved = async (saved: ModelFavorite) => {
    const targets = saved.connections.filter(
      (connection) => connection.providerId && connection.endpointKey,
    );
    if (!targets.length) {
      return;
    }
    const results = await Promise.allSettled(
      targets.map((connection) => loadCatalog(connection.providerId, connection.endpointKey)),
    );
    const failed = results.filter(
      (result) => result.status === 'rejected' || !result.value || result.value.ok === false,
    ).length;
    if (failed) {
      setNotice([{ key: 'warning.favorite.probeFailed', params: { count: failed } }]);
    }
  };
  const submit = async () => {
    const result = createFavoriteRequestSchema.safeParse(favoritePayload(draft, providers));
    if (!result.success) {
      setSubmitted(true);
      const all = locateFavoriteIssues(draft, result.error.issues);
      setError(
        Object.keys(all.fields).length || Object.keys(all.cards).length
          ? ''
          : t('favorites.invalid'),
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await save(result.data, favorite);
      const affected = favorite?.references.some((ref) => ref.needsUpdate || ref.diverged) ?? false;
      const next: FavoriteSaveNext = !favorite ? 'configure' : affected ? 'review' : null;
      toast.success(t('favorites.nextStep.saved', { name: saved.name }), {
        action: next
          ? {
              label: t(
                next === 'configure' ? 'favorites.configure' : 'favorites.nextStep.reviewAffected',
              ),
              onClick: () => onSaved?.(saved, next),
            }
          : undefined,
      });
      onClose();
      void probeSaved(saved);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle>{t(favorite ? 'favorites.edit' : 'favorites.add')}</DialogTitle>
            <DialogDescription>{t('favorites.declared')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <FormField
              id="favorite-name"
              label={t('favorites.name')}
              error={fieldErrors['favorite-name']}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  placeholder={draft.connections[0]?.requestModelId || t('favorites.autoName')}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              )}
            </FormField>
            <div className="flex items-baseline gap-2">
              <h3 className="font-semibold">{t('favorites.connections')}</h3>
              <p className="min-w-0 truncate text-muted-foreground text-xs">
                {t('favorites.channelHint')}
              </p>
            </div>
            {draft.connections.map((connection, index) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                index={index}
                disabled={busy}
                error={cardErrors[connection.id]}
                fieldErrors={fieldErrors}
                modelHints={modelHints?.[`${connection.providerId}/${connection.endpointKey}`]}
                onAddProvider={() => openVault(connection.id)}
                onChange={(patch) => update(connection.id, patch)}
                onRemove={() =>
                  setDraft({
                    ...draft,
                    connections: draft.connections.filter((item) => item.id !== connection.id),
                  })
                }
              />
            ))}
            {!draft.connections.length ? (
              <div className="space-y-3 rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-muted-foreground text-sm">{t('favorites.connectionsEmpty')}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" disabled={busy} onClick={addConnection}>
                    {t('favorites.addConnection')}
                  </Button>
                  {!providers.length ? (
                    <Button variant="ghost" disabled={busy} onClick={() => openVault(null)}>
                      {t('favorites.addProvider')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground"
                disabled={busy || draft.connections.length >= 50}
                onClick={addConnection}
              >
                {t('favorites.addConnection')}
              </Button>
            )}
            <Disclosure
              title={t('favorites.modelAdvanced')}
              forceOpen={advancedError}
              summary={advancedSummary}
              triggerClassName="-ml-4"
            >
              <FormField
                id="favorite-notes"
                label={t('favorites.notes')}
                error={fieldErrors['favorite-notes']}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    maxLength={4096}
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                )}
              </FormField>
              <FavoriteFacts
                id="favorite"
                facts={draft.defaults}
                effort={draft.preferences.reasoningEffort}
                errors={fieldErrors}
                onFacts={(defaults) => setDraft({ ...draft, defaults })}
                onEffort={(value) =>
                  setDraft({
                    ...draft,
                    preferences: {
                      reasoningEffort: favoriteEffortSchema.optional().parse(value || undefined),
                    },
                  })
                }
              />
            </Disclosure>
          </div>
          <div className="shrink-0 space-y-3 border-t bg-muted/20 px-6 py-4">
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <Button className="w-full" disabled={busy} onClick={() => void submit()}>
              {t('favorites.saveFavorite')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ProviderVaultDialog
        open={vaultTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setVaultTarget(undefined);
          }
        }}
      />
    </>
  );
}
