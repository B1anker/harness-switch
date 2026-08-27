import { MultiFileDiff } from '@pierre/diffs/react';
import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';
import { useTranslation } from '@/lib/i18n';
import { usePageTheme } from '@/lib/theme';

const THEME_NAMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

function diffOptions(pageTheme: 'dark' | 'light') {
  return {
    // Single column with per-line markers so each change reads top to bottom.
    diffStyle: 'unified' as const,
    overflow: 'wrap' as const,
    expandUnchanged: true,
    stickyHeader: true,
    // Match whatever mode the surrounding page is currently rendered in.
    themeType: pageTheme,
    theme: THEME_NAMES[pageTheme],
  };
}

export function PierreFileDiff({ file }: { file: BackupFileDetail }) {
  const { t } = useTranslation();
  const pageTheme = usePageTheme();

  const name = file.path;
  const oldFile = file.currentContent === null ? null : { name, contents: file.currentContent };
  const newFile = file.content === null ? null : { name, contents: file.content };

  if (oldFile !== null && newFile !== null) {
    return (
      <MultiFileDiff
        disableWorkerPool
        oldFile={oldFile}
        newFile={newFile}
        options={diffOptions(pageTheme)}
      />
    );
  }
  if (oldFile !== null) {
    return (
      <MultiFileDiff
        disableWorkerPool
        oldFile={oldFile}
        newFile={null}
        options={diffOptions(pageTheme)}
      />
    );
  }
  if (newFile !== null) {
    return (
      <MultiFileDiff
        disableWorkerPool
        oldFile={null}
        newFile={newFile}
        options={diffOptions(pageTheme)}
      />
    );
  }
  return <p className="px-3 py-4 text-sm text-muted-foreground">{t('diff.bothAbsent')}</p>;
}
