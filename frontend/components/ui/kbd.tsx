import { cn } from '@/lib/utils';

const CAP =
  'bg-surface text-ink-secondary border-line border inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-mono text-eyebrow font-normal tracking-normal whitespace-nowrap normal-case';

/**
 * Kbd — a keyboard key cap in the mono face: `surface` with the xs ring, 20px
 * tall, 11px `ink-secondary`. One key as `children` ("⌘K", "Esc"), or `keys`
 * for a combination drawn as separate caps. Never on an `ink` fill: a
 * tooltip prints its shortcut as plain mono text instead.
 */
export function Kbd({
  children,
  keys,
  className,
}: Readonly<{ children?: string; keys?: readonly string[]; className?: string }>) {
  if (keys && keys.length > 1) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        {keys.map((key) => (
          <kbd key={key} className={CAP}>
            {key}
          </kbd>
        ))}
      </span>
    );
  }
  return <kbd className={cn(CAP, className)}>{keys?.[0] ?? children}</kbd>;
}
