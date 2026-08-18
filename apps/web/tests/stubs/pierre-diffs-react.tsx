import type { ComponentProps } from 'react';

type FileSide = { name: string; contents: string } | null;

type StubProps = {
  oldFile: FileSide;
  newFile: FileSide;
} & ComponentProps<'div'>;

/** Test double: rstest aliases `@pierre/diffs/react` here so Shiki never loads. */
export function MultiFileDiff({ oldFile, newFile }: StubProps) {
  return (
    <div>
      <pre>{oldFile?.contents ?? '（当前不存在）'}</pre>
      <p>↓ 恢复后</p>
      <pre>{newFile?.contents ?? '（恢复后删除）'}</pre>
    </div>
  );
}
