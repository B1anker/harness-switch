import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';
import { Component, lazy, type ReactNode, Suspense } from 'react';
import { Badge } from '@/components/ui/badge';

const PierreFileDiff = lazy(async () => {
  const mod = await import('./pierre-file-diff');
  return { default: mod.PierreFileDiff };
});

export type ChangeKind = 'delete' | 'create' | 'replace' | 'same';

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  delete: '将删除',
  create: '将新建',
  replace: '将覆盖',
  same: '无变更',
};

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
  const kind = changeKind(file);
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="min-w-0 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </p>
        <Badge variant="secondary">{CHANGE_KIND_LABEL[kind]}</Badge>
      </div>
      <DiffErrorBoundary fallback={<PlainFileDiff file={file} />}>
        <Suspense
          fallback={<p className="px-3 py-4 text-sm text-muted-foreground">正在渲染差异…</p>}
        >
          <PierreFileDiff file={file} />
        </Suspense>
      </DiffErrorBoundary>
    </div>
  );
}

function PlainFileDiff({ file }: { file: BackupFileDetail }) {
  return (
    <div className="grid gap-2 p-3 font-mono text-xs">
      <pre className="whitespace-pre-wrap text-red-400/90">
        {file.currentContent ?? '（当前不存在）'}
      </pre>
      <p className="font-sans text-muted-foreground">↓ 恢复后</p>
      <pre className="whitespace-pre-wrap text-emerald-400/90">
        {file.content ?? '（恢复后删除）'}
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
