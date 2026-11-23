import { useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { SearchX } from '@/lib/icons';
import { HOME_PATH, recoveryRoute } from '@/lib/navigation/app-routes';

import { NoticePage } from './notice-page';

export function NotFoundScreen() {
  const parent = recoveryRoute(useLocation().pathname ?? '');
  return (
    <NoticePage
      tone="info"
      icon={SearchX}
      label={null}
      heading="Page not found"
      actions={
        <>
          <Button asChild variant="primary">
            <ProjectLink href={parent?.path ?? HOME_PATH}>
              {parent ? `Back to ${parent.title}` : 'Go to Overview'}
            </ProjectLink>
          </Button>
          {parent ? (
            <Button asChild variant="secondary">
              <ProjectLink href={HOME_PATH}>Go to Overview</ProjectLink>
            </Button>
          ) : null}
        </>
      }
    >
      There is no page at this address. Check the link, or go back to a page that exists.
    </NoticePage>
  );
}
