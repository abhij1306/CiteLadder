import { cn } from '@/lib/utils';

/**
 * The chip geometry, shared by every chip-shaped control. `radio-group` renders
 * the same shape from Radix data attributes rather than a boolean, so it takes
 * the base and its own state classes instead of restating the recipe.
 */
export const chipBaseClasses =
  'focus-ring type-badge inline-flex h-[var(--badge-height-md)] items-center gap-2 rounded-full px-3 transition-[background-color,color,border-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)]';

export const chipRestingClasses =
  'control-raised bg-panel text-secondary enabled:hover:bg-hover enabled:hover:text-foreground enabled:active:bg-active';

const chipSelectedClasses =
  'control-raised bg-selected text-foreground enabled:hover:bg-selected enabled:active:bg-active';

/** Shared multi-select/filter chip recipe. */
export function filterChipClasses(active: boolean): string {
  return cn(chipBaseClasses, active ? chipSelectedClasses : chipRestingClasses);
}

/**
 * Tag — the small inline chip that labels a value: a provenance marker, a
 * count, a property name. Six of these were hand-rolled with three different
 * fills, so the same marker read differently on each screen. It is static: badge-height-sm sets the minimum, with no focus or hover.
 */
const TAG_TONE = {
  blue: 'bg-[var(--tag-blue-bg)] border border-[var(--tag-blue-border)] text-[var(--tag-blue-text)]',
  purple:
    'bg-[var(--tag-purple-bg)] border border-[var(--tag-purple-border)] text-[var(--tag-purple-text)]',
  green:
    'bg-[var(--tag-green-bg)] border border-[var(--tag-green-border)] text-[var(--tag-green-text)]',
  moss: 'bg-[var(--tag-moss-bg)] border border-[var(--tag-moss-border)] text-[var(--tag-moss-text)]',
  red: 'bg-[var(--tag-red-bg)] border border-[var(--tag-red-border)] text-[var(--tag-red-text)]',
  orange:
    'bg-[var(--tag-orange-bg)] border border-[var(--tag-orange-border)] text-[var(--tag-orange-text)]',
  amber:
    'bg-[var(--tag-amber-bg)] border border-[var(--tag-amber-border)] text-[var(--tag-amber-text)]',
  teal: 'bg-[var(--tag-teal-bg)] border border-[var(--tag-teal-border)] text-[var(--tag-teal-text)]',
  yellow:
    'bg-[var(--tag-yellow-bg)] border border-[var(--tag-yellow-border)] text-[var(--tag-yellow-text)]',
  neutral:
    'bg-[var(--tag-neutral-bg)] border border-[var(--tag-neutral-border)] text-[var(--tag-neutral-text)]',
  well: 'bg-well text-secondary',
  outline: 'bg-panel text-secondary border border-border',
  accent: 'bg-accent-subtle text-accent-text',
} as const;

export type TagTone = keyof typeof TAG_TONE;

export function tagClasses(tone: TagTone = 'well', className?: string) {
  return cn(
    'type-badge inline-flex min-h-[var(--badge-height-sm)] max-w-full items-center gap-1 rounded-full px-2 py-0.5',
    TAG_TONE[tone],
    className,
  );
}
