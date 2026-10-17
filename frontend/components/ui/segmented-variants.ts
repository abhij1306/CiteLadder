import { cva } from 'class-variance-authority';

export const segmentedTrackVariants = cva(
  'selection-track bg-track inline-flex max-w-full overflow-x-auto scroll-px-1 min-h-[var(--control-height-sm)] items-center gap-0.5 rounded-[var(--radius-control)] p-0.5',
);

export const segmentedItemVariants = cva(
  'focus-ring type-badge shrink-0 inline-flex h-[calc(var(--control-height-sm)-4px)] items-center justify-center rounded-[var(--radius-control)] px-3 whitespace-nowrap transition-[background-color,color,border-color] disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle',
  {
    variants: {
      selected: {
        true: 'selection-raised bg-panel text-foreground enabled:hover:bg-panel enabled:active:bg-active',
        false:
          'text-secondary enabled:hover:bg-hover enabled:hover:text-foreground enabled:active:bg-active',
      },
    },
    defaultVariants: { selected: false },
  },
);
