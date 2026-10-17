import { FolderOpen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * NoProjectState — what a project-scoped route shows when no project is
 * selected.
 *
 * The shared `EmptyState` with the one heading and, when the viewer may create
 * a project, the one "Create project" action; otherwise the one line "Select a
 * project first."
 *
 * The caller decides `createProjectHref` (`newProjectDestination(workspaceId)`)
 * and omits it for a role that may not create projects or a workspace with no
 * remaining project slots, so the action is never offered and then refused.
 */
const NO_PROJECT_HEADING = 'No project selected';

export function NoProjectState({
  createProjectHref,
  headingLevel = 2,
  className,
}: Readonly<{
  /** The new-project route; omit when the viewer cannot create one. */
  createProjectHref?: string | null;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}>) {
  return (
    <EmptyState
      icon={FolderOpen}
      heading={NO_PROJECT_HEADING}
      // Without the action the only way forward is the project switcher.
      description={createProjectHref ? undefined : 'Select a project first.'}
      headingLevel={headingLevel}
      className={className}
      action={
        createProjectHref ? (
          <Button asChild size="sm">
            <Link to={createProjectHref}>
              <Plus className="size-4" aria-hidden />
              Create project
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
