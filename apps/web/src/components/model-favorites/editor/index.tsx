import {
  createFavoriteRequestSchema,
  type FavoriteInput,
  type ModelFacts,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProviderVaultDialog } from '@/components/provider-vault-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { TabPanel } from '@/components/ui/tabs';
import { isCrossFieldIssue, locateFavoriteIssues } from '@/lib/favorite-validation';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';
import { DiscardDraftDialog } from '../discard-draft-dialog';
import { FavoriteCapabilities } from './capabilities';
import { FavoriteConnections } from './connections';
import { EditorHeader } from './header';
import { ToolBindings } from './tool-bindings';

import { useFavoriteDraft } from './use-favorite-draft';

export type FavoriteSaveNext = 'configure' | 'review' | null;

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
  /** Called on save with null, then with the chosen follow-up action if requested. */
  onSaved?(saved: ModelFavorite, next: FavoriteSaveNext): void;
}) {
  const { t } = useTranslation();
  const save = useAppStore((state) => state.saveFavorite);
  const loadCatalog = useAppStore((state) => state.loadFavoriteCatalog);
  const setNotice = useAppStore((state) => state.setNotice);
  const {
    draft,
    setDraft,
    providers,
    vaultTarget,
    setVaultTarget,
    openVault,
    addConnection,
    update,
    selectModels,
    inferredFacts,
    dirty,
  } = useFavoriteDraft(favorite ?? initialDraft, modelHints, hintFacts);
  const [tab, setTab] = useState('connections');
  const [modelSettings, setModelSettings] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestClose = () => {
    if (busy || vaultTarget !== undefined) {
      return;
    }
    if (dirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  };
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
      const connectionError =
        result.error.issues.some(
          (issue) =>
            issue.path[0] === 'connections' &&
            ['providerId', 'endpointKey', 'requestModelId', 'label', 'protocol'].includes(
              String(issue.path[2]),
            ),
        ) || Object.values(all.cards).includes('favorites.validation.duplicateConnection');
      setTab(
        connectionError ||
          all.fields['favorite-name'] ||
          all.fields['favorite-notes'] ||
          result.error.issues.some((issue) =>
            ['defaultConnectionId', 'toolBindings'].includes(String(issue.path[0])),
          )
          ? 'connections'
          : 'capabilities',
      );
      setError(
        Object.keys(all.fields).length || Object.keys(all.cards).length
          ? ''
          : t(all.global[0] ?? 'favorites.invalid'),
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await save(result.data, favorite);
      const refreshed = useAppStore.getState().favorites?.find((entry) => entry.id === saved.id);
      const affected =
        refreshed?.references.some((ref) => ref.needsUpdate || ref.diverged) ?? false;
      const next: FavoriteSaveNext = !favorite ? 'configure' : affected ? 'review' : null;
      onSaved?.(saved, null);
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
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent className="flex h-[min(960px,94dvh)] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden p-0">
          <EditorHeader
            editing={!!favorite}
            draft={draft}
            setDraft={setDraft}
            tab={tab}
            setTab={setTab}
            busy={busy}
            error={fieldErrors['favorite-name']}
          />
          <fieldset disabled={busy} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <div hidden={tab !== 'connections'}>
              <TabPanel
                idPrefix="favorite-editor"
                value="connections"
                className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
              >
                <div className="min-w-0 space-y-3">
                  <FavoriteConnections
                    draft={draft}
                    setDraft={setDraft}
                    providers={providers}
                    busy={busy}
                    fieldErrors={fieldErrors}
                    cardErrors={cardErrors}
                    modelHints={modelHints}
                    openVault={openVault}
                    update={update}
                    addConnection={addConnection}
                    selectModels={selectModels}
                    onModelSettings={(id) => {
                      setModelSettings(id);
                      setTab('capabilities');
                    }}
                  />
                </div>
                <div className="min-w-0 border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                  <ToolBindings draft={draft} setDraft={setDraft} />
                </div>
              </TabPanel>
            </div>
            <div hidden={tab !== 'capabilities'}>
              <TabPanel idPrefix="favorite-editor" value="capabilities">
                <FavoriteCapabilities
                  draft={draft}
                  setDraft={setDraft}
                  update={update}
                  inferredFacts={inferredFacts}
                  fieldErrors={fieldErrors}
                  cardErrors={cardErrors}
                  focusConnectionId={modelSettings}
                />
              </TabPanel>
            </div>
          </fieldset>
          <div className="shrink-0 space-y-3 border-t bg-muted/20 px-6 py-3">
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={busy} onClick={() => void submit()}>
                {t('favorites.saveFavorite')}
              </Button>
            </div>
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
      <DiscardDraftDialog open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={onClose} />
    </>
  );
}
