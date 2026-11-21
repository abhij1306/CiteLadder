import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { SearchX } from '@/lib/icons';
import { HOME_PATH } from '@/lib/navigation/app-routes';

import { NoticePage } from './notice-page';

export function NotFoundScreen() {
  return (
    <NoticePage
      tone="info"
      icon={SearchX}
      label={null}
      heading="Page not found"
      actions={
        <Button asChild variant="primary">
          <ProjectLink href={HOME_PATH}>Go to Overview</ProjectLink>
        </Button>
      }
    >
      There is no page at this address. Check the link, or go back to Overview.
    </NoticePage>
  );
}
