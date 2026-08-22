import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';
import { Component, lazy, type ReactNode, Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';

const PierreFileDiff = lazy(async () => {
  const mod = await import('./pierre-file-diff');
  return { default: mod.PierreFileDiff };
});

export type ChangeKind = 'delete' | 'create' | 'replace' | 'same';

export function changeKind(file: BackupFileDetail): ChangeKind {
  if (file.content === null && file.currentContent === null) {
    return 'same';
  }
  if (file.content === null) {
    return 'delete';
  }
  if (file.currentContent === null) {
    return 'create';
  }
  return file.content === file.currentContent ? 'same' : 'replace';
}

export function ConfigDiffs({ files }: { files: BackupFileDetail[] }) {
  return (
    <div className="space-y-3">
      {files.map((file) => (
        <ConfigFileDiff key={file.path} file={file} />
      ))}
    </div>
  );
}

function ConfigFileDiff({ file }: { file: BackupFileDetail }) {
  const { t } = useTranslation();
  const kind = changeKind(file);
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="min-w-0 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </p>
        <Badge variant="secondary">{t(`diff.${kind}`)}</Badge>
      </div>
      <DiffErrorBoundary fallback={<PlainFileDiff file={file} />}>
        <Suspense
          fallback={
            <p className="px-3 py-4 text-sm text-muted-foreground">{t('diff.rendering')}</p>
          }
        >
          <PierreFileDiff file={file} />
        </Suspense>
      </DiffErrorBoundary>
    </div>
  );
}

function PlainFileDiff({ file }: { file: BackupFileDetail }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 p-3 font-mono text-xs">
      <pre className="whitespace-pre-wrap text-red-400/90">
        {file.currentContent ?? t('diff.absent')}
      </pre>
      <p className="font-sans text-muted-foreground">{t('diff.afterRestore')}</p>
      <pre className="whitespace-pre-wrap text-emerald-400/90">
        {file.content ?? t('diff.deletedAfterRestore')}
      </pre>
    </div>
  );
}

type BoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type BoundaryState = {
  failed: boolean;
};

class DiffErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
