import { Fragment, type ReactNode } from 'react';

import { ChevronRight } from '@/lib/icons';
import { ProjectLink } from '@/components/ui/project-link';
import { textRole } from '@/components/ui/typography';

export type Crumb = Readonly<{
  label: string;
  href?: string;
  state?: unknown;
  mark?: ReactNode;
}>;

export function Breadcrumb({ parts }: Readonly<{ parts: readonly Crumb[] }>) {
  const current = parts.at(-1);
  return (
    <nav aria-label="Breadcrumb" className="not-rail:w-0 flex min-w-28 flex-1">
      <ol className={textRole('body', 'text-ink-2 flex min-w-0 items-center gap-2')}>
        {parts.slice(0, -1).map((part, index) => (
          <Fragment key={part.label}>
            <li className={index === 0 ? 'min-w-6 shrink-[0.001]' : 'min-w-6 shrink'}>
              {part.href ? (
                <ProjectLink
                  href={part.href}
                  state={part.state}
                  className="hover:overlay-hover hover:text-ink focus-ring rounded-mark block min-h-6 max-w-68 min-w-6 truncate px-1 py-0.5"
                >
                  {part.label}
                </ProjectLink>
              ) : (
                <span className="block max-w-68 truncate px-1">{part.label}</span>
              )}
            </li>
            <li aria-hidden className="shrink-0">
              <ChevronRight className="block size-3" />
            </li>
          </Fragment>
        ))}
        {current ? (
          <li
            aria-current="page"
            className="text-ink flex min-w-12 shrink-[1000] items-center gap-2"
          >
            {current.mark}
            <span className="min-w-0 truncate">{current.label}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
