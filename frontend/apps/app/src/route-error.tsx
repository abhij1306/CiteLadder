import { SearchX, TriangleAlert } from 'lucide-react';

import { ListScreen } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/layout/scoped-link';
import { ShellFallback } from '@/components/layout/shell-fallback';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { QueryState } from '@/components/ui/query-state';
import { textRole } from '@/components/ui/typography';

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
    <ListScreen title="Something went wrong">
      <QueryState
        kind="empty"
        icon={TriangleAlert}
        heading="This page could not be opened"
        description="Reload to try again, or go back to Overview."
        action={
          <>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            <OverviewLink variant="secondary" />
          </>
        }
      />
    </ListScreen>
  );
}

/** An application URL that matches no screen. */
export function NotFoundScreen() {
  return (
    <ListScreen title="Page not found">
      <QueryState
        kind="empty"
        icon={SearchX}
        heading="There is no page at this address"
        description="Check the link, or go back to Overview."
        action={<OverviewLink />}
      />
    </ListScreen>
  );
}

/** A fresh document also recovers route chunks replaced by a deployment. */
export function RouteError() {
  return (
    <ShellFallback>
      <main id="main" className="grid min-h-[60vh] place-items-center p-[var(--page-section-gap)]">
        <Alert tone="warning" className="max-w-lg">
          <div className="grid gap-4">
            <h1 className={textRole('sectionTitle')}>This page could not be opened</h1>
            <p>Reload this page to try again.</p>
            <Button className="w-fit" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </Alert>
      </main>
    </ShellFallback>
  );
}
