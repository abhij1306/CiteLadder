import { textRole } from '@/components/ui/typography';
import { cn, emailInitials } from '@/lib/utils';

/**
 * Avatar — a person's initials on a neutral disc.
 *
 * The well fill with secondary ink (never accent — an avatar identifies, it
 * does not act), uppercase initials at the size's role, a full circle.
 *
 *   - `sm` (28px) — beside a name in a row or a menu trigger.
 *   - `md` (40px) — the identity row of a profile.
 *
 * The disc is decorative and hidden from assistive tech: the adjacent text (or
 * the control's own accessible name) names the person, so it is not read twice.
 */
const SIZE = {
  sm: textRole('caption', 'size-7'),
  md: textRole('itemTitle', 'size-10'),
} as const;

export type AvatarSize = keyof typeof SIZE;

export function Avatar({
  name,
  size = 'sm',
  className,
}: Readonly<{
  /** The person's name or email; the initials come from it. */
  name: string;
  size?: AvatarSize;
  className?: string;
}>) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-well text-secondary flex shrink-0 items-center justify-center rounded-full uppercase',
        SIZE[size],
        className,
      )}
    >
      {emailInitials(name)}
    </span>
  );
}
