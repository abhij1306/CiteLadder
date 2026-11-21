import { useState } from 'react';

import { brandInitials } from '@/lib/brand/initials';
import { brandMarkSources } from '@/lib/brand/mark-sources';
import { cn } from '@/lib/utils';

const PLACEMENT = {
  inline: { pixels: 16, box: 'size-4 rounded-mark text-eyebrow tracking-normal', image: 'size-4' },
  row: { pixels: 20, box: 'size-5 rounded-mark text-caption', image: 'size-5' },
  header: { pixels: 24, box: 'bg-surface size-10 rounded-control text-label-lg', image: 'size-6' },
} as const;

export type BrandMarkPlacement = keyof typeof PLACEMENT;

export function BrandMark({
  name,
  logoUrl,
  websiteUrl,
  placement = 'row',
}: Readonly<{
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  placement?: BrandMarkPlacement;
}>) {
  const [failed, setFailed] = useState<Record<string, true>>({});
  const spec = PLACEMENT[placement];

  const src = brandMarkSources({ logoUrl, websiteUrl, pixels: spec.pixels }).find(
    (candidate) => !failed[candidate],
  );
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
          className={cn(
            'block object-contain',
            spec.image,
            placement !== 'header' && 'rounded-mark',
          )}
          onError={() => setFailed((prev) => ({ ...prev, [src]: true }))}
        />
      ) : (
        <span
          className={cn(
            'bg-ink text-on-ink grid place-items-center font-medium uppercase',
            placement === 'header' ? 'size-full' : spec.image,
          )}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
