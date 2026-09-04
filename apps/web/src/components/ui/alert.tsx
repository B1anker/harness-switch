import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('text-sm', {
  variants: {
    variant: {
      /** A failure the user has to act on: what the form or the request refused. */
      destructive: 'text-destructive',
      /** Something that succeeded with a caveat worth reading. */
      warning: 'text-amber-600 dark:text-amber-500',
      /** Context for the control above it, not an outcome. */
      muted: 'text-muted-foreground',
    },
    size: {
      default: 'text-sm',
      sm: 'text-xs',
    },
  },
  defaultVariants: { variant: 'destructive', size: 'default' },
});

/**
 * One line of feedback under a form or a request.
 *
 * Forty places spelled out a `text-destructive` paragraph, and they had drifted between
 * `text-sm` and `text-xs` with no rule behind which was which. `role="alert"` is on by
 * default because these are almost always rendered in response to something the user just
 * did, and a screen reader that misses them leaves the user waiting.
 */
export function Alert({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'p'> & VariantProps<typeof alertVariants>) {
  return (
    <p
      data-slot="alert"
      role={variant === 'muted' ? undefined : 'alert'}
      className={cn(alertVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { alertVariants };
