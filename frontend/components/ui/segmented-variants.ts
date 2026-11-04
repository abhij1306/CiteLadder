import { cva } from 'class-variance-authority';

// One control height (32) for every segment; the group is a row of segments
// on the surface it sits on, with no track fill (owner, 2026-11-03: at most
// three surface levels, selection is a bar plus ink, never a fill).
export const segmentedTrackVariants = cva(
  // `segmented-track` is a marker only (the geometry census measures it).
  'segmented-track inline-flex max-w-full overflow-x-auto h-[var(--control-height-md)] items-center gap-0.5',
);

export const segmentedItemVariants = cva(
  // A segment is a control, so it sets control text (14), not badge text.
  'focus-ring type-control shrink-0 inline-flex h-[var(--control-height-md)] items-center justify-center rounded-[var(--radius-control)] px-[var(--tab-pad-x)] whitespace-nowrap transition-[background-color,color] disabled:cursor-not-allowed disabled:text-muted',
  {
    variants: {
      selected: {
        true: 'selection-bar-foot text-foreground enabled:hover:bg-hover enabled:active:bg-active',
        false:
          'text-secondary enabled:hover:bg-hover enabled:hover:text-foreground enabled:active:bg-active',
      },
    },
    defaultVariants: { selected: false },
  },
);
