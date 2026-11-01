import { ArrowLeft } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { cn } from '@/lib/utils';

import { buttonVariants } from './button-variants';
import { Icon } from './icon';

/**
 * BackButton — a detail route's way up to its collection: a round 32px
 * control with the back arrow, set before the page title. The label ("Back to
 * runs") is its accessible name and hover hint; the route is scoped to the
 * active project (or `projectId`) like any app link.
 */
export function BackButton({
  href,
  label,
  projectId,
  className,
}: Readonly<{
  /** The collection route, e.g. `/runs`. */
  href: string;
  /** What pressing it does, e.g. "Back to runs". */
  label: string;
  /** Scope to this project rather than the active one. */
  projectId?: string | null;
  className?: string;
}>) {
  return (
    <ProjectLink
      href={href}
      projectId={projectId}
      aria-label={label}
      title={label}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'icon' }),
        'shrink-0 rounded-full',
        className,
      )}
    >
      <Icon icon={ArrowLeft} />
    </ProjectLink>
  );
}
