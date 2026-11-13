import { Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ProjectLink } from '@/components/ui/project-link';
import { QueryState } from '@/components/ui/query-state';
import { TextLink } from '@/components/ui/text-link';
import { useWorkspaceCapability } from '@/lib/project/project-context';

const PROVIDER_SETTINGS = '/settings?tab=providers';

/**
 * Keyword Research without a DataForSEO login and no saved results: a login
 * to add. The login is a credential, so only a role that manages credentials is sent to add it.
 */
export function NotConnected() {
  const canManage = useWorkspaceCapability('manage_credentials');
  if (!canManage)
    return (
      <QueryState
        kind="empty"
        icon={Unplug}
        heading="Connect DataForSEO"
        description="Ask a workspace Owner or Admin to add a DataForSEO login."
      />
    );
  return (
    <QueryState
      kind="empty"
      icon={Unplug}
      heading="Connect DataForSEO"
      description="Add your DataForSEO login once to run analyses."
      action={
        <Button asChild variant="secondary">
          <ProjectLink href={PROVIDER_SETTINGS}>Open provider settings</ProjectLink>
        </Button>
      }
    />
  );
}

/** Why saved results cannot be refreshed: no DataForSEO connection. */
export function UnavailableNotice({ data }: Readonly<{ data: { connected: boolean } }>) {
  const canManage = useWorkspaceCapability('manage_credentials');
  if (data.connected) return null;
  return (
    <Callout tone="negative">
      DataForSEO is not connected, so saved results can be read but not refreshed.{' '}
      {canManage ? (
        <TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>
      ) : (
        'A workspace Owner or Admin can add the login.'
      )}
    </Callout>
  );
}
