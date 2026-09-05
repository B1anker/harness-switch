import { create } from 'zustand';
import { createBackupSlice } from './slices/backups';
import { createGithubSlice } from './slices/github';
import { createHarnessSlice } from './slices/harnesses';
import { createInsightSlice } from './slices/insights';
import { createFavoriteSlice } from './slices/model-favorites';
import { createNoticeSlice } from './slices/notice';
import { createOperationSlice } from './slices/operations';
import { createProbeSlice } from './slices/probe';
import { createProviderSlice } from './slices/providers';
import { createScanSlice } from './slices/scan';
import { createSessionSlice } from './slices/session';
import type { AppState } from './types';

export type { AppState };

export const useAppStore = create<AppState>()((...args) => ({
  ...createSessionSlice(...args),
  ...createFavoriteSlice(...args),
  ...createHarnessSlice(...args),
  ...createBackupSlice(...args),
  ...createProviderSlice(...args),
  ...createProbeSlice(...args),
  ...createInsightSlice(...args),
  ...createScanSlice(...args),
  ...createOperationSlice(...args),
  ...createGithubSlice(...args),
  ...createNoticeSlice(...args),
}));
