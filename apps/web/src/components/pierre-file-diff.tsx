import { MultiFileDiff } from '@pierre/diffs/react';
import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';
import { useTranslation } from '@/lib/i18n';
import { usePageTheme } from '@/lib/theme';
import type { BundledLanguageId } from '@/shiki/bundle';

const THEME_NAMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

/**
 * Which grammar each config file extension needs.
 *
 * Every adapter target is JSON, TOML or YAML (see `AdapterTarget.format`), so those three
 * are the whole surface. The build ships exactly those grammars and drops the other ~250
 * (`rspack.config.ts`), which only holds because we pass `lang` explicitly: left to infer,
 * @pierre/diffs maps extensions across its full table and would ask for a grammar that is
 * no longer in the bundle.
 *
 * Typing the values as `BundledLanguageId` is what keeps the two ends honest — naming a
 * language the bundle does not carry is a type error rather than a blank diff at runtime.
 */
const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguageId> = {
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
};

/** Anything unrecognised renders as plain text, which needs no grammar at all. */
function languageOf(path: string): BundledLanguageId | 'text' {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? 'text';
}

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
  const lang = languageOf(name);
  const oldFile =
    file.currentContent === null ? null : { name, lang, contents: file.currentContent };
  const newFile = file.content === null ? null : { name, lang, contents: file.content };

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
