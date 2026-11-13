import type { ReactNode } from 'react';

import { FLOAT_FACE } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * FloatingBar — a page's few actions, centered at the foot of its column and
 * floating over it while it scrolls, then resting after its last section, so
 * it never covers that section. A floating surface (D51): the float face at
 * the card radius, secondary actions first and the one primary last. A
 * fieldset names the group for assistive technology.
 */
export function FloatingBar({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        'sticky bottom-[var(--page-section-gap)] z-10 flex flex-wrap items-center justify-center gap-2 self-center rounded-lg p-2',
        FLOAT_FACE,
      )}
    >
      {children}
    </fieldset>
  );
}
