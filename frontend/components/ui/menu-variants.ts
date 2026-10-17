import { cva } from 'class-variance-authority';

/**
 * Shared visual contract for menus and custom listboxes. The overlay shadow
 * draws the hairline edge; the transparent border keeps the box geometry and
 * becomes the visible edge in forced colours, where shadows are dropped.
 */
export const menuPanelClasses =
  'menu-panel border-transparent bg-elevated shadow-overlay z-modal overflow-hidden rounded-[var(--radius-card)] border p-1 focus-ring';

export const menuItemVariants = cva(
  'text-foreground hover:bg-hover data-[highlighted]:bg-hover active:bg-active data-[active=true]:bg-selected data-[state=checked]:bg-selected data-[active=true]:hover:bg-selected data-[state=checked]:hover:bg-selected data-[active=true]:data-[highlighted]:bg-selected data-[state=checked]:data-[highlighted]:bg-selected relative flex min-h-[var(--menu-item-height)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] py-1 type-control transition-colors focus-ring data-[disabled]:pointer-events-none data-[disabled]:bg-disabled data-[disabled]:text-muted data-[state=checked]:data-[disabled]:bg-disabled data-[active=true]:data-[disabled]:bg-disabled',
  {
    variants: {
      inset: {
        true: 'ps-8 pe-2',
        false: 'px-2',
      },
      selected: {
        true: 'bg-selected text-foreground hover:bg-selected',
        false: null,
      },
    },
    defaultVariants: {
      inset: false,
      selected: false,
    },
  },
);
