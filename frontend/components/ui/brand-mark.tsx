import { useState } from 'react';

import { logoDevUrl } from '@/lib/brand/logo-dev';
import { brandInitials } from '@/lib/brand/initials';
import { cn } from '@/lib/utils';

/**
 * A placement, never a size: each context draws the mark in one form.
 *
 *   - `inline` (16px) — in text, pills and a run of marks inside a cell.
 *   - `row`    (20px) — beside a name in a table or list row, a menu or the switcher.
 *   - `header` (40px) — a detail header: the favicon at 24px on a `surface`
 *                       tile with the xs ring.
 */
const PLACEMENT = {
  inline: { pixels: 16, box: 'size-4 rounded-xs text-eyebrow tracking-normal', image: 'size-4' },
  row: { pixels: 20, box: 'size-5 rounded-xs text-caption', image: 'size-5' },
  header: { pixels: 24, box: 'bg-surface shadow-xs size-10 rounded-sm text-body', image: 'size-6' },
} as const;

export type BrandMarkPlacement = keyof typeof PLACEMENT;

/**
 * BrandMark — a website's real favicon, or its first letter in `on-ink` on
 * `ink` when there is none, wherever a brand or cited domain is named. Never
 * a globe, never a redrawn logo, never recoloured.
 *
 * The sources, each tried only when the one before fails to load: our own
 * cached favicon (same-origin, the real icon), then Logo.dev's CDN (sites that
 * refuse our crawler), then the letter. Decorative: the adjacent name carries
 * the accessible label.
 */
export function BrandMark({
  name,
  logoUrl,
  websiteUrl,
  placement = 'row',
}: Readonly<{
  name: string;
  logoUrl?: string | null;
  /** Brand site, used to derive the Logo.dev fallback. */
  websiteUrl?: string | null;
  placement?: BrandMarkPlacement;
}>) {
  const [failed, setFailed] = useState<Record<string, true>>({});
  const spec = PLACEMENT[placement];

  const cached = logoUrl && !failed[logoUrl] ? logoUrl : null;
  const remote = logoDevUrl(websiteUrl, spec.pixels);
  const src = cached ?? (remote && !failed[remote] ? remote : null);
  const [letter = '?'] = brandInitials(name);

  return (
    <span
      aria-hidden
      data-brand-mark={placement}
      className={cn('grid shrink-0 place-items-center overflow-hidden', spec.box)}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          width={spec.pixels}
          height={spec.pixels}
          className={cn('block object-contain', spec.image, placement !== 'header' && 'rounded-xs')}
          onError={() => setFailed((prev) => ({ ...prev, [src]: true }))}
        />
      ) : (
        <span
          className={cn(
            'bg-ink text-on-ink grid place-items-center leading-none font-medium uppercase',
            placement === 'header' ? 'size-full' : spec.image,
          )}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
