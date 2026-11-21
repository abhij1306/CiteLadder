import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { ROWS_SHELL } from '@/components/ui/work-rows';
import { textRole } from '@/components/ui/typography';
import { ChevronRight } from '@/lib/icons';
import { cn } from '@/lib/utils';

const FACT = 'w-24 shrink-0 truncate';

export function LinkRows({
  label,
  children,
  more,
}: Readonly<{ label: string; children: ReactNode; more?: ReactNode }>) {
  return (
    <div className={ROWS_SHELL}>
      <ul aria-label={label} className="divide-rule divide-y">
        {children}
      </ul>
      {more}
    </div>
  );
}

export function LinkRow({
  tick,
  href,
  state,
  name,
  facts,
}: Readonly<{
  tick?: ReactNode;
  href: string;
  state?: unknown;
  name: ReactNode;
  facts: readonly [ReactNode, ReactNode];
}>) {
  return (
    <li className="hover:overlay-hover relative flex h-10 items-center gap-3 px-4">
      {tick ? <span className="relative z-10 flex shrink-0">{tick}</span> : null}
      <ProjectLink
        href={href}
        state={state}
        className="focus-ring rounded-mark min-w-0 flex-1 truncate before:absolute before:inset-x-0 before:inset-y-0"
      >
        {name}
      </ProjectLink>
      <span className={textRole('caption', cn('text-ink-2 phone:hidden', FACT))}>{facts[0]}</span>
      <span className={textRole('caption', cn('text-ink-2 flex tabular-nums', FACT))}>
        {facts[1]}
      </span>
      <Icon icon={ChevronRight} className="text-ink-2 shrink-0" />
    </li>
  );
}
