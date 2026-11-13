import { useState } from 'react';

import { cn, emailInitials } from '@/lib/utils';

/**
 * A placement, never a size: `byline` (20px) inline in a byline, `row` (28px)
 * in rows, menus and the account button, `profile` (40px) in a profile header.
 */
const PLACEMENT = {
  byline: 'size-5 text-eyebrow tracking-normal',
  row: 'size-7 text-caption',
  profile: 'size-10 text-body-sm',
} as const;

export type AvatarPlacement = keyof typeof PLACEMENT;

/**
 * Avatar — a person's photo or initials in a circle: the first and last
 * word's first letters in `ink` on `surface-sunken` with a 1px `line` border; a
 * failed photo falls back to the initials. Never coloured per person, never
 * a company (that is `BrandMark`). Decorative: the adjacent text or the
 * control's name says who it is.
 */
export function Avatar({
  name,
  src,
  placement = 'row',
}: Readonly<{
  /** The person's name or email; the initials come from it. */
  name: string;
  src?: string | null;
  placement?: AvatarPlacement;
}>) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden
      className={cn(
        'bg-surface-sunken border-line text-ink grid shrink-0 place-items-center overflow-hidden rounded-full border font-medium uppercase',
        PLACEMENT[placement],
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        emailInitials(name)
      )}
    </span>
  );
}
