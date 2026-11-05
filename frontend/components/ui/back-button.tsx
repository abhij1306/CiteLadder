import { ArrowLeft } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { cn } from '@/lib/utils';

import { buttonClasses } from './button';
import { Icon } from './icon';
import { Tooltip } from './tooltip';

/**
 * BackButton — a detail route's way up to its collection: the secondary
 * IconButton face with the back arrow, set before the page title. The label
 * ("Back to runs") is its accessible name and tooltip; the route is scoped to
 * the active project (or `projectId`) like any app link.
 */
export function BackButton({
  href,
  label,
  projectId,
}: Readonly<{
  /** The collection route, e.g. `/runs`. */
  href: string;
  /** What pressing it does, e.g. "Back to runs". */
  label: string;
  /** Scope to this project rather than the active one. */
  projectId?: string | null;
}>) {
  return (
    <Tooltip content={label} describe={false}>
      <ProjectLink
        href={href}
        projectId={projectId}
        aria-label={label}
        className={cn(buttonClasses('secondary'), 'w-[var(--control-md)] gap-0 px-0')}
      >
        <Icon icon={ArrowLeft} />
      </ProjectLink>
    </Tooltip>
  );
}
