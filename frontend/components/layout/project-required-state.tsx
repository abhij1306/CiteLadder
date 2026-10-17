'use client';

import { useCreateProjectHref } from '@/components/layout/use-project-creation';
import { NoProjectState } from '@/components/ui/no-project-state';

/**
 * `NoProjectState` with the "Create project" action decided for the viewer.
 * A component rather than a call in the route, so the capability read runs
 * only on the branch that has no project.
 */
export function ProjectRequiredState({ headingLevel }: Readonly<{ headingLevel?: 1 | 2 | 3 }>) {
  return <NoProjectState createProjectHref={useCreateProjectHref()} headingLevel={headingLevel} />;
}
