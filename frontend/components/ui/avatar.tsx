import { useState } from 'react';

import { cn, emailInitials } from '@/lib/utils';

const PLACEMENT = {
  byline: 'size-5 type-caption',
  row: 'size-7 type-caption',
  profile: 'size-10 type-body',
} as const;

export type AvatarPlacement = keyof typeof PLACEMENT;

export function Avatar({
  name,
  src,
  placement = 'row',
}: Readonly<{
  name: string;
  src?: string | null;
  placement?: AvatarPlacement;
}>) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden
      className={cn(
        'bg-well border-transparent text-ink grid shrink-0 place-items-center overflow-hidden rounded-full border font-medium uppercase',
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
