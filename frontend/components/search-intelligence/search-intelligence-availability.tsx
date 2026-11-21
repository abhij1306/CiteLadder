import { Database, Unplug } from '@/lib/icons';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { TextLink } from '@/components/ui/text-link';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const PROVIDER_SETTINGS = '/settings?tab=providers';

export type ResearchTab = 'overview' | 'keywords' | 'competitors' | 'backlinks';

const TAB_EMPTY: Readonly<Record<ResearchTab, string>> = {
  overview: 'See where you rank and where competitors outrank you',
  keywords: 'See the keywords your website ranks for',
  competitors: 'See the keywords competitors rank for and you do not',
  backlinks: 'See who links to your website',
};

export function NoAnalysisYet({ tab, action }: Readonly<{ tab: ResearchTab; action: ReactNode }>) {
  return <StateBlock kind="empty" icon={Database} heading={TAB_EMPTY[tab]} action={action} />;
}

/**
 * Keyword Research without a DataForSEO login and no saved results: a login
 * to add. The login is a credential, so only a role that manages credentials is sent to add it.
 */
export function NotConnected() {
  const canManage = useWorkspaceCapability('manage_credentials');
  let state = (
    <StateBlock
      kind="empty"
      icon={Unplug}
      heading="Connect DataForSEO"
      action={
        <Button asChild>
          <ProjectLink href={PROVIDER_SETTINGS}>Open provider settings</ProjectLink>
        </Button>
      }
    />
  );
  if (!canManage)
    state = (
      <StateBlock
        kind="empty"
        icon={Unplug}
        heading="Connect DataForSEO"
        description="Ask a workspace Owner or Admin to add a DataForSEO login."
      />
    );
  return state;
}

/** Why saved results cannot be refreshed: no DataForSEO connection. */
export function UnavailableNotice({ data }: Readonly<{ data: { connected: boolean } }>) {
  const canManage = useWorkspaceCapability('manage_credentials');
  if (data.connected) return null;
  return (
    <Notice tone="negative">
      DataForSEO is not connected, so saved results can be read but not refreshed.{' '}
      {canManage ? (
        <TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>
      ) : (
        'A workspace Owner or Admin can add the login.'
      )}
    </Notice>
  );
}
