import {
  ERROR_CODES,
  type FavoriteItemResult,
  type FavoritePlanRequest,
  type HarnessId,
  type HarnessSummary,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { compatibleConnections, favoriteSelection } from '@/lib/favorite-selection';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export type ApplyResult = FavoriteItemResult & { mode: 'save' | 'activate' };
export type ApplyDialogProps = {
  favorite: ModelFavorite;
  onClose(): void;
  initialItems?: FavoritePlanRequest['items'];
  initialMode?: 'save' | 'activate';
  initialPreview?: boolean;
  onApplied?(): void;
  quickHarness?: HarnessSummary;
  onEditConnections?(): void;
};

export function useApplyWorkflow({
  favorite,
  onClose,
  initialItems = [],
  initialMode = 'save',
  initialPreview = false,
  onApplied,
  quickHarness,
}: ApplyDialogProps) {
  const { t } = useTranslation();
  const plan = useAppStore((state) => state.favoritePlan);
  const makePlan = useAppStore((state) => state.planFavorite);
  const apply = useAppStore((state) => state.applyFavorite);
  const clear = useAppStore((state) => state.clearFavoritePlan);
  const targets = useAppStore((state) => state.favoriteTargets[favorite.id]);
  const loadTargets = useAppStore((state) => state.loadFavoriteTargets);
  const [items, setItems] = useState(initialItems);
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState<0 | 1 | 2>(initialPreview || quickHarness ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const [needsPreview, setNeedsPreview] = useState(false);
  const [channel, setChannel] = useState('');
  const [quickReady, setQuickReady] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const applying = useRef(false);
  const running = useRef(false);
  const attempted = useRef(false);
  const submittedItems = useRef(new Map<HarnessId, FavoritePlanRequest['items'][number]>());
  const mounted = useRef(true);
  const connections = quickHarness ? compatibleConnections(favorite, quickHarness.id, targets) : [];
  const selectedChannel =
    channel ||
    (quickHarness ? favoriteSelection(favorite, quickHarness, targets, mode).connectionId : '');
  const connection = connections.find((entry) => entry.id === selectedChannel);
  const failed = results.some((item) => item.status === 'failed' || item.status === 'skipped');
  const completedHarnesses = results
    .filter((item) => item.status === 'applied' || item.status === 'unchanged')
    .map((item) => item.harness);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void loadTargets(favorite.id).catch((cause) => {
      if (active) {
        setError(lineText(t, errorLine(cause)));
      }
    });
    return () => {
      active = false;
    };
  }, [favorite.id, loadTargets, t]);
  useEffect(() => {
    if (!quickHarness || !selectedChannel || applying.current || attempted.current || step !== 1) {
      return;
    }
    let active = true;
    clear();
    setQuickReady(false);
    setError('');
    const selection = [
      {
        ...favoriteSelection(favorite, quickHarness, targets, mode),
        connectionId: selectedChannel,
      },
    ];
    setItems(selection);
    setRequestId(crypto.randomUUID());
    void makePlan({
      favoriteId: favorite.id,
      expectedRevision: favorite.revision,
      items: selection,
    })
      .then(() => {
        if (active) {
          setQuickReady(true);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(lineText(t, errorLine(cause)));
        }
      });
    return () => {
      active = false;
    };
  }, [
    quickHarness,
    selectedChannel,
    favorite,
    targets,
    mode,
    clear,
    makePlan,
    t,
    previewAttempt,
    step,
  ]);

  const run = async (action: () => Promise<void>) => {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current) {
        setError(lineText(t, errorLine(cause)));
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  const preview = async (selection = items) => {
    attempted.current = true;
    setQuickReady(false);
    await makePlan({
      favoriteId: favorite.id,
      expectedRevision: favorite.revision,
      items: selection,
    });
    if (mounted.current) {
      setRequestId(crypto.randomUUID());
      setNeedsPreview(false);
      setUncertain(false);
      setQuickReady(true);
      setStep(1);
    }
  };
  const submit = () =>
    run(async () => {
      if (!plan || applying.current) {
        return;
      }
      applying.current = true;
      attempted.current = true;
      for (const item of items) {
        submittedItems.current.set(item.harness, item);
      }
      try {
        const operation = await apply(requestId);
        if (!mounted.current || !operation) {
          return;
        }
        const next = operation.items.map((item) => ({
          ...item,
          mode: plan.items.find((entry) => entry.harness === item.harness)!.mode,
        }));
        setResults((previous) => [
          ...previous.filter((item) => !next.some((entry) => entry.harness === item.harness)),
          ...next,
        ]);
        setUncertain(false);
        setStep(2);
      } catch (cause) {
        if (!mounted.current) {
          return;
        }
        const rejected =
          cause instanceof ApiError &&
          (cause.code === ERROR_CODES.favoritePlanExpired ||
            cause.code === ERROR_CODES.favoritePlanStale);
        setNeedsPreview(rejected);
        setUncertain(!rejected);
        throw cause;
      } finally {
        applying.current = false;
      }
    });
  const retry = () =>
    run(async () => {
      const remaining = results
        .filter((result) => result.status === 'failed' || result.status === 'skipped')
        .flatMap((result) => {
          const item =
            items.find((entry) => entry.harness === result.harness) ??
            submittedItems.current.get(result.harness);
          return item ? [item] : [];
        });
      setItems(remaining);
      await preview(remaining);
    });
  const close = () => {
    if (busy || running.current) {
      return;
    }
    clear();
    if (completedHarnesses.length) {
      onApplied?.();
    }
    onClose();
  };
  const change = (harness: HarnessId, patch: Partial<FavoritePlanRequest['items'][number]>) => {
    clear();
    setItems((previous) =>
      previous.map((item) => (item.harness === harness ? { ...item, ...patch } : item)),
    );
  };
  const changeChannel = (value: string) => {
    attempted.current = false;
    setChannel(value);
    setPreviewAttempt((attempt) => attempt + 1);
  };
  const refreshQuickPreview = () => {
    attempted.current = false;
    setPreviewAttempt((value) => value + 1);
  };
  return {
    plan,
    clear,
    targets,
    items,
    setItems,
    mode,
    setMode,
    step,
    setStep,
    busy,
    error,
    setError,
    results,
    failed,
    completedHarnesses,
    uncertain,
    needsPreview,
    quickReady,
    connections,
    selectedChannel,
    connection,
    changeChannel,
    refreshQuickPreview,
    run,
    preview,
    submit,
    retry,
    close,
    change,
    loadTargets,
  };
}
