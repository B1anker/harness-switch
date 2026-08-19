import { MultiFileDiff } from '@pierre/diffs/react';
import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';

const DIFF_OPTIONS = {
  themeType: 'dark' as const,
  theme: 'pierre-dark',
  diffStyle: 'unified' as const,
  overflow: 'wrap' as const,
  expandUnchanged: true,
  stickyHeader: true,
};

export function PierreFileDiff({ file }: { file: BackupFileDetail }) {
  const name = file.path;
  const oldFile = file.currentContent === null ? null : { name, contents: file.currentContent };
  const newFile = file.content === null ? null : { name, contents: file.content };

  if (oldFile !== null && newFile !== null) {
    return (
      <MultiFileDiff disableWorkerPool oldFile={oldFile} newFile={newFile} options={DIFF_OPTIONS} />
    );
  }
  if (oldFile !== null) {
    return (
      <MultiFileDiff disableWorkerPool oldFile={oldFile} newFile={null} options={DIFF_OPTIONS} />
    );
  }
  if (newFile !== null) {
    return (
      <MultiFileDiff disableWorkerPool oldFile={null} newFile={newFile} options={DIFF_OPTIONS} />
    );
  }
  return <p className="px-3 py-4 text-sm text-muted-foreground">两侧都不存在</p>;
}
