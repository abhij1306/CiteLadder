import { textRole } from '@/components/ui/typography';
import { cn, emailInitials } from '@/lib/utils';

/**
 * Avatar — a person's initials on a neutral disc.
 *
 * The well fill with secondary ink (never accent — an avatar identifies, it
 * does not act), uppercase initials, a full circle.
 *
 * A placement, never a size: each context has one form.
 *
 *   - `inline`   (24px) — beside a name in a row, or inside the account
 *                         menu's 32px trigger.
 *   - `identity` (40px) — the identity row of a profile.
 *
 * The disc is decorative and hidden from assistive tech: the adjacent text (or
 * the control's own accessible name) names the person, so it is not read twice.
 */
const PLACEMENT = {
  inline: textRole('caption', 'size-6'),
  identity: textRole('itemTitle', 'size-10'),
} as const;

export type AvatarPlacement = keyof typeof PLACEMENT;

export function Avatar({
  name,
  placement = 'inline',
}: Readonly<{
  /** The person's name or email; the initials come from it. */
  name: string;
  placement?: AvatarPlacement;
}>) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-well text-secondary flex shrink-0 items-center justify-center rounded-full uppercase',
        PLACEMENT[placement],
      )}
    >
      {emailInitials(name)}
    </span>
  );
}
