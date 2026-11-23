import { cn } from '@/lib/utils';

const CAP =
  'border-transparent bg-state-selected text-ink-2 inline-flex h-5 min-w-5 items-center justify-center rounded-mark border px-1 type-data-sm whitespace-nowrap normal-case';

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
