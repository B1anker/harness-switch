import type { StateCreator } from 'zustand';
import type { BackupSlice } from './slices/backups';
import type { GithubSlice } from './slices/github';
import type { HarnessSlice } from './slices/harnesses';
import type { InsightSlice } from './slices/insights';
import type { NoticeSlice } from './slices/notice';
import type { OperationSlice } from './slices/operations';
import type { ProbeSlice } from './slices/probe';
import type { ProviderSlice } from './slices/providers';
import type { ScanSlice } from './slices/scan';
import type { SessionSlice } from './slices/session';

/**
 * The single store the whole app reads. Slices are a way to keep the file sizes honest,
 * not a boundary: each one is written against the full state, because loading harnesses
 * refreshes drift, adopting drift reloads harnesses, and so on.
 */
export type AppState = SessionSlice &
  HarnessSlice &
  BackupSlice &
  ProviderSlice &
  ProbeSlice &
  InsightSlice &
  ScanSlice &
  OperationSlice &
  GithubSlice &
  NoticeSlice;

export type Slice<T> = StateCreator<AppState, [], [], T>;

/** What a slice may hand to `set`, narrowed from zustand's replace-or-merge overloads. */
export type SetState = (partial: Partial<AppState>) => void;
