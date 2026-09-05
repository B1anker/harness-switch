import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Button } from './button';

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {title}
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      <div id={id} hidden={!open} className="space-y-3">
        {children}
      </div>
    </div>
  );
}
