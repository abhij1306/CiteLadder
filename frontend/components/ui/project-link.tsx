'use client';

import { Link } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { isAppRoute } from '@/lib/navigation/app-route';
import { useProjectHref } from '@/lib/navigation/project-destination';

type ProjectLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & {
  href: string;
  projectId?: string | null;
};

/** A link whose destination is owned by the currently selected project. */
export function ProjectLink({ href, projectId, ...props }: Readonly<ProjectLinkProps>) {
  const projectHref = useProjectHref();
  if (!isAppRoute(href)) {
    const { children, className } = props;
    return <span className={className}>{children}</span>;
  }
  return <Link to={projectHref(href, projectId)} {...props} />;
}
