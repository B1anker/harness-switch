import type { BackupDetail, BackupEntry, BackupsResponse } from '@seaveyon/harness-switch-shared';
import { ApiError, api, backupRestorePath, backupsPath } from '@/lib/api';
import { errorLine } from '@/lib/messages';
import type { Slice } from '../types';

export type BackupSlice = {
  backups: BackupEntry[];
  loadBackups: () => Promise<void>;
  loadBackupDetail: (id: string) => Promise<BackupDetail>;
  restoreBackup: (id: string) => Promise<void>;
};

export const createBackupSlice: Slice<BackupSlice> = (set, get) => ({
  backups: [],

  loadBackups: async () => {
    try {
      const data = await api<BackupsResponse>(backupsPath());
      set({ backups: data.items });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        set({ error: errorLine(error) });
      }
    }
  },

  loadBackupDetail: async (id) => {
    return api<BackupDetail>(backupsPath(id));
  },

  restoreBackup: async (id) => {
    await api(backupRestorePath(id), { method: 'POST' });
    set({ notice: [{ key: 'backup.written' }] });
    await Promise.all([get().loadHarnesses(), get().loadBackups()]);
  },
});
