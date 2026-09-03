import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { usePageTheme } from '@/lib/theme';

/** shadcn-style Sonner wrapper, wired to the page theme instead of next-themes. */
export function Toaster(props: ToasterProps) {
  const theme = usePageTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
