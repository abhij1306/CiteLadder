import { cn } from '@/lib/utils';

/**
 * Tag — the small inline chip that labels a value: a provenance marker, a
 * count, a property name. Six of these were hand-rolled with three different
 * fills, so the same marker read differently on each screen. It is static: the
 * one badge height (20) sets the minimum, with no focus or hover. Anything the
 * user clicks is a 32px control, never a tag.
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
