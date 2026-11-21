import { ChevronDown } from '@/lib/icons';
import type { ReactNode } from 'react';
import { textRole } from './typography';

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
      className="disclosure grid min-w-0 gap-3"
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary
        className={textRole(
          'body',
          'text-ink-2 focus-ring hover:text-ink hover:overlay-hover flex min-h-[var(--target-min)] w-fit cursor-pointer items-center gap-2 rounded-control px-2 transition-colors duration-[var(--motion-fast)] [&::-webkit-details-marker]:hidden',
        )}
      >
        {title}
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </summary>
      <div className="grid min-w-0 gap-3 pt-3">{children}</div>
    </details>
  );
}
