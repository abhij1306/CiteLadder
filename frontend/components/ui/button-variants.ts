import { cva } from 'class-variance-authority';

/** Shared filled controls use shadow rings; focus keeps its own outline. */
export const buttonVariants = cva(
  'focus-ring type-control inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] no-underline transition-[transform,background-color,color,border-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle aria-disabled:pointer-events-none aria-disabled:bg-disabled aria-disabled:text-muted aria-disabled:border-border-subtle aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:not-disabled:hover:bg-selected aria-pressed:disabled:bg-disabled aria-pressed:disabled:text-muted aria-disabled:aria-pressed:bg-disabled aria-disabled:aria-pressed:text-muted data-[state=open]:bg-selected data-[state=open]:text-foreground data-[state=open]:not-disabled:hover:bg-selected data-[state=open]:disabled:bg-disabled data-[state=open]:disabled:text-muted',
  {
    variants: {
      variant: {
        primary:
          'control-raised bg-accent-fill text-accent-fg not-disabled:hover:bg-accent-fill-hover active:bg-accent-fill-active',
        accent:
          'control-raised bg-accent-soft text-accent-text not-disabled:hover:bg-accent-fill not-disabled:hover:text-accent-fg active:bg-accent-fill-hover active:text-accent-fg',
        secondary:
          'control-raised bg-input text-foreground not-disabled:hover:bg-hover active:bg-active',
        tonal:
          'control-raised bg-accent-subtle text-accent-text not-disabled:hover:bg-accent-border active:bg-accent-border',
        neutral:
          'control-raised bg-background-alt text-foreground not-disabled:hover:bg-hover active:bg-active',
        ghost:
          'bg-transparent text-secondary shadow-none not-disabled:hover:bg-hover not-disabled:hover:text-foreground active:bg-active',
        destructive:
          'control-raised bg-danger-solid text-danger-fg not-disabled:hover:bg-danger-solid-hover active:bg-danger-solid-hover',
        destructiveGhost:
          'bg-transparent text-danger-text shadow-none not-disabled:hover:bg-danger-bg active:bg-danger-bg',
      },
      // The product has one text button (`md`) and one icon button (`icon`),
      // both 32. `lg` (36) is the onboarding flow's rung only.
      size: {
        md: 'h-[var(--control-height-md)] px-3',
        lg: 'h-[var(--control-height-lg)] px-4',
        icon: 'size-[var(--control-height-md)] px-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);
