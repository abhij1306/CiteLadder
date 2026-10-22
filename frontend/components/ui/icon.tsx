import type { ComponentPropsWithoutRef, ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * What the atom hands a glyph: its box, its ink and its accessible name. A
 * lucide icon takes these, and so does a brand glyph (`BrandGlyph`).
 */
type GlyphProps = Readonly<{
  className?: string;
  'aria-hidden'?: true;
  'aria-label'?: string;
  role?: 'img';
  'data-icon'?: '';
}>;

/**
 * A brand's own multi-colour mark drawn as an inline SVG (the Google "G" on
 * Continue with Google): a component that spreads `GlyphProps` onto its
 * `<svg>` and carries its own fills, so `Icon` sizes it like any glyph.
 */
export type BrandGlyph = ComponentType<GlyphProps>;

/**
 * Icon — a glyph at the product's one icon size, 16px.
 *
 * Feature screens used to size their lucide glyphs at 12, 14 and 16 beside
 * the same 14px text, so an arrow next to a caption looked different from the
 * same arrow next to a label. The atom has one form: the caller picks the
 * glyph and, through `className`, its ink — never its size. Decorative by
 * default; pass `label` when the glyph alone carries meaning. A brand glyph
 * takes the same 16px box; its fills are its own.
 *
 * The glyph occupies one 20px body line (2 above and below), so in a row
 * aligned to the top it sits centred on the first line of text beside it
 * without a per-call nudge.
 */
export function Icon({
  icon: Glyph,
  label,
  className,
}: Readonly<{ icon: LucideIcon | BrandGlyph; label?: string; className?: string }>) {
  return (
    <Glyph
      data-icon=""
      className={cn('my-0.5 size-4 shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

/**
 * IconTile — the 32px recessed square that names a row's kind (a data source,
 * an integration) beside its title: the control height, the control radius,
 * the hairline edge and the 16px glyph centred in it. Decorative; the title
 * beside it carries the name.
 */
export function IconTile({ icon }: Readonly<{ icon: LucideIcon }>) {
  return (
    <span
      aria-hidden
      data-icon-tile=""
      className="bg-well border-border text-secondary flex size-[var(--control-height-md)] shrink-0 items-center justify-center rounded-[var(--radius-control)] border"
    >
      <Icon icon={icon} />
    </span>
  );
}

/**
 * Dot — the 6px status marker a badge carries, for a live or severity mark
 * beside text that is not a badge (a polling indicator, a list bullet). The
 * caller supplies the fill (`bg-info`) and any motion class; colour is never
 * the only signal, so the text beside it says the same thing.
 */
export function Dot({
  className,
  ...props
}: Readonly<Omit<ComponentPropsWithoutRef<'span'>, 'children'>>) {
  return (
    <span
      {...props}
      className={cn('inline-block size-1.5 shrink-0 rounded-full', className)}
      aria-hidden
    />
  );
}
