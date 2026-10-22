'use client';

import { useState } from 'react';

import { logoDevUrl } from '@/lib/brand/logo-dev';
import { brandInitials } from '@/lib/brand/initials';
import { cn } from '@/lib/utils';

/**
 * A placement, never a size: each context draws the mark in one form.
 *
 *   - `mark`     (16px) — a favicon in a run of marks inside a cell.
 *   - `row`      (20px) — beside a name in a row, a cell, a menu or the switcher.
 *   - `identity` (40px) — the identity header of the brand or page itself.
 */
const PLACEMENT = {
  mark: { pixels: 16, className: 'size-4 rounded-xs type-badge' },
  row: { pixels: 20, className: 'size-5 rounded-xs type-badge' },
  identity: { pixels: 40, className: 'size-10 rounded-[var(--radius-control)] type-figure-sm' },
} as const;

export type BrandLogoPlacement = keyof typeof PLACEMENT;

/**
 * One brand-avatar treatment everywhere, with a three-step fallback:
 * our own cached favicon → Logo.dev's CDN → deterministic initials.
 *
 * The cached asset comes first because it is the real icon, served same-origin
 * from our database. Logo.dev covers the sites that refuse *our* crawler
 * (bot-blocking WAFs), which is a gap no crawler improvement can close. Each
 * step is entered only when the previous image actually fails to load, so a
 * working logo never costs a third-party request.
 *
 * Decorative: the adjacent brand name carries the accessible label.
 */
export function BrandLogo({
  name,
  logoUrl,
  websiteUrl,
  placement = 'row',
}: Readonly<{
  name: string;
  logoUrl?: string | null;
  /** Brand site, used to derive the Logo.dev fallback. */
  websiteUrl?: string | null;
  placement?: BrandLogoPlacement;
}>) {
  const [failed, setFailed] = useState<Record<string, true>>({});
  const spec = PLACEMENT[placement];

  const cached = logoUrl && !failed[logoUrl] ? logoUrl : null;
  const remote = logoDevUrl(websiteUrl, spec.pixels);
  // Only reach for the CDN once the cached asset is gone or has failed.
  const src = cached ?? (remote && !failed[remote] ? remote : null);

  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden uppercase',
        spec.className,
      )}
    >
      {src ? (
        <img
          // Keyed by src so swapping sources remounts the element; without it
          // React reuses the <img> and a cached error state can suppress the
          // load event for the replacement.
          key={src}
          src={src}
          alt=""
          width={spec.pixels}
          height={spec.pixels}
          // The plate stays: fetched marks are frequently transparent with dark
          // glyphs, and the app-shell rows these sit in are tonal, not white.
          className="bg-panel size-full object-contain p-0.5"
          onError={() => setFailed((prev) => ({ ...prev, [src]: true }))}
        />
      ) : (
        // Only the initials fallback gets a ground: it is generated text, not
        // a logo asset. Brand marks are transparent and render on the surface
        // they sit on.
        <span className="bg-well text-secondary grid size-full place-items-center">
          {brandInitials(name)}
        </span>
      )}
    </span>
  );
}
