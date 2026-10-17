import { cn } from '@/lib/utils';

import {
  LOGO_BARS,
  LOGO_BUBBLE,
  LOGO_GLYPH_BASELINE,
  LOGO_GLYPH_SCALE,
  LOGO_GLYPH_STROKE,
  LOGO_GLYPHS,
  LOGO_MARK_WIDTH,
  LOGO_VIEWBOX_WIDTH,
} from './logo-glyphs';

/**
 * Official CiteLadder brand logo: the speech-bubble mark, with or without the
 * wordmark. Drawn inline in two tokens only — the ink (`currentColor`, the
 * bubble and "Ladder") and the forest accent (the bars and "Cite") — so both
 * forms resolve to the current theme without a filter and never carry a
 * colour outside the palette. Sizing is governed by `BRAND_LOGO_SIZES` or an
 * explicit `size`.
 */

export const BRAND_LOGO_SIZES = {
  brand: 18,
  sidebar: 18,
  compact: 16,
  mini: 14,
} as const;

export type BrandLogoVariant = keyof typeof BRAND_LOGO_SIZES;

export function LogoMark({
  size,
  variant = 'brand',
  wordmark = true,
  alt = '',
  className,
}: Readonly<{
  size?: number;
  variant?: BrandLogoVariant;
  wordmark?: boolean;
  alt?: string;
  className?: string;
}>) {
  const resolvedSize = size ?? BRAND_LOGO_SIZES[variant];
  const viewWidth = wordmark ? LOGO_VIEWBOX_WIDTH : LOGO_MARK_WIDTH;

  return (
    <span
      className={cn('text-brand-ink inline-flex shrink-0 items-center select-none', className)}
      aria-hidden={alt ? undefined : 'true'}
      aria-label={alt || undefined}
      role={alt ? 'img' : undefined} // NOSONAR -- an inline SVG painted with currentColor theme tokens, which an <img> cannot inherit
    >
      <svg
        viewBox={`0 0 ${viewWidth} 100`}
        width={Math.round((resolvedSize * viewWidth) / 100)}
        height={resolvedSize}
        aria-hidden="true"
        focusable="false"
        className="block shrink-0 fill-current"
      >
        <path d={LOGO_BUBBLE} />
        {LOGO_BARS.map((bar) => (
          <rect key={bar.x} {...bar} rx="1.1" className="fill-accent" />
        ))}
        {wordmark
          ? LOGO_GLYPHS.map((glyph) => (
              <path
                key={glyph.x}
                d={glyph.d}
                transform={`translate(${glyph.x} ${LOGO_GLYPH_BASELINE}) scale(${LOGO_GLYPH_SCALE} -${LOGO_GLYPH_SCALE})`}
                className={glyph.tone === 'accent' ? 'fill-accent stroke-accent' : 'stroke-current'}
                strokeWidth={LOGO_GLYPH_STROKE}
                strokeLinejoin="round"
                strokeLinecap="round"
                paintOrder="stroke fill"
              />
            ))
          : null}
      </svg>
    </span>
  );
}
