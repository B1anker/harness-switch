import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { FieldControlProps } from '@/components/ui/form-field';
import { cn } from '@/lib/utils';

export function CreatableCombobox({
  value,
  options,
  onChange,
  placeholder,
  searchLabel,
  emptyHint,
  customLabel,
  getLabel = (item: string) => item,
  disabled,
  trigger,
  ...control
}: FieldControlProps & {
  value: string;
  options: string[];
  onChange(value: string): void;
  placeholder: string;
  searchLabel: string;
  emptyHint: string;
  customLabel?(value: string): string;
  getLabel?(value: string): string;
  disabled?: boolean;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const candidates = [...new Set(value ? [value, ...options] : options)];
  const filtered = candidates.filter((item) =>
    `${getLabel(item)} ${item}`.toLowerCase().includes(query.toLowerCase()),
  );
  const custom = query.trim();
  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery('');
      }}
    >
      <Popover.Trigger asChild>
        {trigger ?? (
          <Button
            {...control}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2 text-left font-normal"
          >
            <span className={cn('min-w-0 truncate', value ? 'font-mono' : 'text-muted-foreground')}>
              {value ? getLabel(value) : placeholder}
            </span>
            <ChevronsUpDown className="shrink-0 text-muted-foreground" />
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[60] min-w-64 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <Command label={searchLabel} shouldFilter={false} loop className="w-full">
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Command.Input
                aria-label={searchLabel}
                placeholder={searchLabel}
                maxLength={120}
                value={query}
                onValueChange={setQuery}
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List
              label={searchLabel}
              className="max-h-64 overflow-y-auto overscroll-contain p-1.5"
            >
              {!filtered.length && (!custom || !customLabel) ? (
                <p className="px-3 py-4 text-xs text-muted-foreground">{emptyHint}</p>
              ) : null}
              {filtered.map((item) => (
                <Command.Item
                  key={item}
                  value={item}
                  onSelect={() => select(item)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <Check className={cn('size-4 shrink-0', value !== item && 'invisible')} />
                  <span className="break-all">{getLabel(item)}</span>
                </Command.Item>
              ))}
              {customLabel && custom && !candidates.includes(custom) ? (
                <Command.Item
                  value={custom}
                  onSelect={() => select(custom)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <Plus className="size-4 shrink-0" />
                  <span className="break-all">{customLabel(custom)}</span>
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
