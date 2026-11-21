import { cn } from '@/lib/utils';

export function Spinner({
  label,
  showLabel = false,
  className,
}: Readonly<{
  label?: string;
  showLabel?: boolean;
  className?: string;
}>) {
  const Root = label ? 'output' : 'span';
  return (
    <Root
      aria-label={label && !showLabel ? label : undefined}
      aria-hidden={label ? undefined : true}
      data-live-rung=""
      className={cn('inline-flex shrink-0 items-center gap-2 align-middle', className)}
    >
      <span aria-hidden className="inline-grid size-3.5 shrink-0 place-items-center">
        <span className="animate-live-rung rounded-mark block h-3 w-1 bg-current" />
      </span>
      {label && showLabel ? <span className="type-body text-ink-2">{label}</span> : null}
    </Root>
  );
}
