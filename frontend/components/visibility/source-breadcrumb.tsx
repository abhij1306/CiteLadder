import type { ReactNode } from 'react';

import { ChevronRight } from '@/lib/icons';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';

export function SourceBreadcrumb({
  trail,
  current,
  actions,
}: Readonly<{
  trail: readonly { label: string; onClick: () => void }[];
  current?: string;
  actions?: ReactNode;
}>) {
  return (
    <Inline gap="compact" className="flex-wrap">
      <nav aria-label="Sources breadcrumb" className="min-w-0 flex-1">
        <Inline as="ol" gap="tight" className="flex-wrap">
          {trail.map((crumb, index) => (
            <Inline as="li" gap="tight" key={crumb.label}>
              <TextLink asChild tone="muted" text="caption">
                <Pressable onClick={crumb.onClick} className="w-auto">
                  {crumb.label}
                </Pressable>
              </TextLink>
              {current !== undefined || index < trail.length - 1 ? (
                <Icon icon={ChevronRight} className="text-ink-2" />
              ) : null}
            </Inline>
          ))}
          {current === undefined ? null : (
            <li className="min-w-0">
              <span aria-current="page" className={textRole('heading', 'block truncate')}>
                {current}
              </span>
            </li>
          )}
        </Inline>
      </nav>
      {actions}
    </Inline>
  );
}
