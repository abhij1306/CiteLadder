import type { ComponentPropsWithoutRef, ComponentType } from 'react';

import type { IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

type GlyphProps = Readonly<{
  className?: string;
  'aria-hidden'?: true;
  'aria-label'?: string;
  role?: 'img';
  'data-icon'?: '';
}>;

export type BrandGlyph = ComponentType<GlyphProps>;

export function Icon({
  icon: Glyph,
  label,
  className,
}: Readonly<{ icon: IconGlyph | BrandGlyph; label?: string; className?: string }>) {
  return (
    <Glyph
      data-icon=""
      className={cn('my-0.75 size-3.5 shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

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
