import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { FirstFrame } from '@/components/layout/first-frame';
import { NoticePage, NoticeScreen } from '@/components/templates/notice-page';
import { Button, buttonClasses } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { isChunkLoadError, reportClientError } from '@/lib/client-errors';

function useReportedRouteError(kind: 'render' | 'route') {
  const caught = useRouteError();
  useEffect(() => {
    let error = caught;
    if (isRouteErrorResponse(caught)) error = new Error(`${caught.status} ${caught.statusText}`);
    reportClientError({ kind: isChunkLoadError(error) ? 'chunk_load' : kind, error });
  }, [caught, kind]);
}

function OverviewLink({ variant }: Readonly<{ variant?: 'secondary' }>) {
  return (
    <Button asChild variant={variant ?? 'primary'}>
      <ProjectLink href="/projects">Go to Overview</ProjectLink>
    </Button>
  );
}

function ReloadButton() {
  return (
    <Button variant="primary" onClick={() => window.location.reload()}>
      Reload page
    </Button>
  );
}

const COULD_NOT_OPEN = {
  heading: 'This page could not be opened',
  children: 'Reload to try again, or go back to Overview.',
} as const;

/**
 * A screen that failed to render, shown inside the shell so navigation
 * stays available. Reloading also recovers a route chunk replaced by a
 * deployment.
 */
export function ScreenError() {
  useReportedRouteError('render');
  return (
    <NoticePage
      tone="negative"
      {...COULD_NOT_OPEN}
      actions={
        <>
          <ReloadButton />
          <OverviewLink variant="secondary" />
        </>
      }
    />
  );
}

export function RouteError() {
  useReportedRouteError('route');
  return (
    <FirstFrame>
      <NoticeScreen
        tone="warning"
        heading="This page could not be opened"
        actions={<ReloadButton />}
      >
        Reload this page to try again.
      </NoticeScreen>
    </FirstFrame>
  );
}

export function ShellRouteError() {
  useReportedRouteError('route');
  return (
    <FirstFrame>
      <NoticePage
        tone="warning"
        {...COULD_NOT_OPEN}
        actions={
          <>
            <ReloadButton />
            <a href="/projects" className={buttonClasses('secondary')}>
              Go to Overview
            </a>
          </>
        }
      />
    </FirstFrame>
  );
}
