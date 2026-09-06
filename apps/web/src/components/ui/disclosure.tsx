import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Button } from './button';

export function Disclosure({
  title,
  children,
  forceOpen = false,
  summary,
  triggerClassName,
}: {
  title: string;
  children: ReactNode;
  /** Pins the section open, e.g. when a validation error lands inside it. */
  forceOpen?: boolean;
  /** Muted text after the title, e.g. the defaults hidden inside while collapsed. */
  summary?: string;
  /** Extra classes on the trigger, e.g. a negative margin to align its text with the page. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const expanded = open || forceOpen;
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={triggerClassName}
      >
        {title}
        {summary ? (
          <span className="font-normal text-muted-foreground text-xs">{summary}</span>
        ) : null}
        <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </Button>
      <div id={id} hidden={!expanded} className="space-y-3">
        {children}
      </div>
    </div>
  );
}
