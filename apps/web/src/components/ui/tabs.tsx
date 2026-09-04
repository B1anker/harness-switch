import type * as React from 'react';
import { cn } from '@/lib/utils';

export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/**
 * A roving-focus tab rail.
 *
 * The harness rail and the transfer rail look nothing alike but behaved identically down
 * to the arrow-key wrap-around, and each carried its own copy of the handler. The selected
 * styling lives here too, since both had already converged on the same one.
 */
export function TabList<T extends { id: string }>({
  label,
  idPrefix,
  items,
  value,
  onChange,
  orientation = 'horizontal',
  className,
  tabClassName,
  children,
}: {
  label: string;
  idPrefix: string;
  items: readonly T[];
  value: string | undefined;
  onChange: (id: T['id']) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  tabClassName?: string;
  children: (item: T, selected: boolean) => React.ReactNode;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextIndex(event.key, index, items.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    const item = items[next];
    if (!item) {
      return;
    }
    onChange(item.id);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className={className}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-controls={panelId(idPrefix, item.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center rounded-xl text-left transition-[color,background-color,box-shadow,transform] duration-150 active:translate-y-px',
              selected
                ? 'bg-primary/[0.09] text-primary shadow-[inset_0_0_0_1px_rgb(99_91_255/0.13)]'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
              tabClassName,
            )}
          >
            {children(item, selected)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Both rails accept the arrow keys of either axis, because the transfer rail is a column
 * on a wide screen and a row on a narrow one and the user cannot be asked to notice.
 */
function nextIndex(key: string, index: number, length: number): number | null {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return length - 1;
  }
  const forward = key === 'ArrowRight' || key === 'ArrowDown';
  const backward = key === 'ArrowLeft' || key === 'ArrowUp';
  if (!forward && !backward) {
    return null;
  }
  return (index + (forward ? 1 : -1) + length) % length;
}

/**
 * A two-or-three-way switch drawn as one inset control.
 *
 * Distinct from {@link TabList}: these choose what a section *does* — push or pull, device
 * code or token — rather than which of several panels is showing, so they report through
 * `aria-pressed` and do not take arrow keys.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  children,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  children: (option: T) => React.ReactNode;
}) {
  return (
    <div className={cn('grid rounded-lg bg-muted p-1', className)} style={columns(options.length)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
            option === value
              ? 'bg-background text-foreground shadow-sm'
              : 'cursor-pointer text-muted-foreground hover:text-foreground',
          )}
        >
          {children(option)}
        </button>
      ))}
    </div>
  );
}

function columns(count: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
}

export function TabPanel({
  idPrefix,
  value,
  as: Element = 'div',
  className,
  children,
}: {
  idPrefix: string;
  value: string;
  as?: 'div' | 'main';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Element
      role="tabpanel"
      id={panelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      className={className}
    >
      {children}
    </Element>
  );
}
