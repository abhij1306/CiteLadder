import type { ReactNode } from 'react';
import { textRole } from './typography';

/** Native keyboard-accessible disclosure with the shared focus and text treatment. */
export function Disclosure({
  title,
  children,
  onOpenChange,
}: Readonly<{
  title: ReactNode;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}>) {
  return (
    <details
      className="grid min-w-0 gap-3"
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary
        className={textRole(
          'label',
          'focus-ring hover:text-foreground w-fit cursor-pointer rounded-[var(--radius-control)]',
        )}
      >
        {title}
      </summary>
      <div className="grid min-w-0 gap-3 pt-3">{children}</div>
    </details>
  );
}
