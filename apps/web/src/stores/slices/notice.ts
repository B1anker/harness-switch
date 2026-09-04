import type { MessageLine } from '@/lib/messages';
import type { Slice } from '../types';

export type NoticeSlice = {
  /**
   * Lines for the toast. Kept as keys rather than sentences because these are built
   * outside React, where there is no `t`; the toast component resolves them as it fires.
   */
  notice: MessageLine[] | null;
  /** Lets a dialog hand its success message to the toast so it can close itself. */
  setNotice: (notice: MessageLine[]) => void;
  clearNotice: () => void;
};

export const createNoticeSlice: Slice<NoticeSlice> = (set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),
});
