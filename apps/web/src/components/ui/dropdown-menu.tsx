import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A menu anchored to its trigger, closing on a pointer press anywhere outside it.
 *
 * The trigger is given `aria-expanded`, so a caller that wants to turn a chevron can style
 * it with `group-aria-expanded:` rather than being handed the open state. `children`
 * receives a `close` to call once its action has succeeded — a failed action leaves the
 * menu up for a retry, which is why closing is not automatic.
 */
export function DropdownMenu({
  label,
  className,
  trigger,
  children,
}: {
  label: string;
  className?: string;
  trigger: React.ReactElement<React.ComponentProps<'button'>>;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  return (
    <div ref={menuRef} className={cn('relative', className)}>
      {React.cloneElement(trigger, {
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: () => setOpen((value) => !value),
      })}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A row of the menu.
 *
 * A row that cannot be picked must not light up under the cursor, or it reads as clickable
 * right up until the click does nothing.
 */
export function DropdownMenuItem({
  className,
  disabled,
  destructive,
  ...props
}: React.ComponentProps<'button'> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
        destructive && 'text-destructive',
        disabled
          ? 'cursor-default opacity-60'
          : destructive
            ? 'cursor-pointer hover:bg-destructive/10'
            : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-3 py-2 text-xs text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 border-t', className)} />;
}
