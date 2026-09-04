import type * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** What a control must spread to be described by its label and its error. */
export type FieldControlProps = {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
};

/**
 * A labelled control with its error and hint underneath.
 *
 * The three `aria-*` attributes tying a control to its message were written out at every
 * input, which is exactly the kind of wiring that goes missing on the tenth one. Passing
 * them to the control as a render argument means a field cannot be added without them.
 *
 * `error` is already-resolved prose: the caller holds the `t` that knows the field's own
 * interpolations.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  className,
  labelClassName,
  children,
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      {children(controlProps(id, error))}
      <FieldError id={id}>{error}</FieldError>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** For the controls that carry their own layout and cannot sit inside a `FormField`. */
export function controlProps(id: string, error?: unknown): FieldControlProps {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId(id) : undefined,
  };
}

export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={errorId(id)} className="text-xs text-destructive">
      {children}
    </p>
  );
}

function errorId(id: string): string {
  return `${id}-error`;
}
