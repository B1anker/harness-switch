import { cn } from '@/lib/utils';

/** The H/S switch monogram, with contrast tuned independently for each theme. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block size-6 overflow-hidden rounded-[26%]', className)}
    >
      <img
        alt=""
        className="size-full object-cover dark:hidden"
        draggable={false}
        src="/brand-mark-light.png"
      />
      <img
        alt=""
        className="hidden size-full object-cover dark:block"
        draggable={false}
        src="/brand-mark-dark.png"
      />
    </span>
  );
}
