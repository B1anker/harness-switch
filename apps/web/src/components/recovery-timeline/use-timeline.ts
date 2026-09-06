import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function useTimeline() {
  const { t } = useTranslation();
  const backups = useAppStore((state) => state.favoriteBackups);
  const load = useAppStore((state) => state.loadFavoriteBackups);
  const create = useAppStore((state) => state.createFavoriteBackup);
  const restore = useAppStore((state) => state.restoreFavoriteBackup);
  const preview = useAppStore((state) => state.favoriteBackupPreview);
  const inspect = useAppStore((state) => state.previewFavoriteBackup);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    const pending = request;
    void load()
      .catch((cause) => {
        if (active) {
          setError(lineText(t, errorLine(cause)));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      pending.current++;
    };
  }, [load, t]);
  const select = async (id: string | null) => {
    if (writing) {
      return;
    }
    const sequence = ++request.current;
    setSelectedId(id);
    setError('');
    setNotice('');
    setChecking(!!id);
    if (!id) {
      return;
    }
    try {
      await inspect(id);
    } catch (cause) {
      if (sequence === request.current) {
        setError(lineText(t, errorLine(cause)));
      }
    } finally {
      if (sequence === request.current) {
        setChecking(false);
      }
    }
  };
  const mutate = async (action: () => Promise<void>, message: string) => {
    if (writing) {
      return;
    }
    request.current++;
    setWriting(true);
    setChecking(false);
    setError('');
    setNotice('');
    try {
      await action();
      setSelectedId(null);
      setNotice(t(message));
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setWriting(false);
    }
  };
  const selected = backups.find((entry) => entry.id === selectedId);
  const impact = !checking && !error && preview?.id === selectedId ? preview : null;
  return {
    backups,
    selected,
    loading,
    checking,
    writing,
    error,
    notice,
    impact,
    select,
    create: () => mutate(create, 'favorites.backupCreated'),
    restore: () =>
      selected && impact
        ? mutate(() => restore(selected.id, impact.fingerprint), 'favorites.backupRestored')
        : Promise.resolve(),
  };
}
