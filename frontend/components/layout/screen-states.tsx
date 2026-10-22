'use client';

import { SearchX, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

import { PageShell } from './page-shell';
import { ProjectLink } from './scoped-link';

function OverviewLink({ variant }: Readonly<{ variant?: 'secondary' }>) {
  return (
    <Button asChild variant={variant}>
      <ProjectLink href="/projects">Go to Overview</ProjectLink>
    </Button>
  );
}

/**
 * A screen that failed to render, shown inside the shell so navigation
 * stays available. Reloading also recovers a route chunk replaced by a
 * deployment.
 */
export function ScreenError() {
  return (
    <PageShell title="Something went wrong">
      <EmptyState
        icon={TriangleAlert}
        heading="This page could not be opened"
        description="Reload to try again, or go back to Overview."
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            <OverviewLink variant="secondary" />
          </div>
        }
      />
    </PageShell>
  );
}

/** An application URL that matches no screen. */
export function NotFoundScreen() {
  return (
    <PageShell title="Page not found">
      <EmptyState
        icon={SearchX}
        heading="There is no page at this address"
        description="Check the link, or go back to Overview."
        action={<OverviewLink />}
      />
    </PageShell>
  );
}
