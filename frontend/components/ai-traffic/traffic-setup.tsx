import { useState } from 'react';

import { ActionButton, ACTIONS } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { StateBlock } from '@/components/ui/state-block';
import { Unplug } from '@/lib/icons';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { CrawlLogConnections } from './crawl-log-connections';

export function TrafficSetupState({
  ga4Missing,
  crawlAvailable,
}: Readonly<{
  ga4Missing: boolean;
  crawlAvailable: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const canManage = useWorkspaceCapability('manage_credentials');
  const connectCrawl = crawlAvailable ? (
    <ActionButton action="connectCrawlLogs" onClick={() => setOpen(true)} disabled={!canManage} />
  ) : null;
  return (
    <>
      {ga4Missing ? (
        <StateBlock
          kind="empty"
          icon={Unplug}
          heading="Connect a traffic source"
          action={
            <>
              <Button asChild>
                <ProjectLink href="/ai-traffic?tab=referrals">
                  Connect Google Analytics 4
                </ProjectLink>
              </Button>
              {crawlAvailable ? (
                <Button variant="quiet" onClick={() => setOpen(true)} disabled={!canManage}>
                  <Icon icon={ACTIONS.connectCrawlLogs.icon} />
                  {ACTIONS.connectCrawlLogs.label}
                </Button>
              ) : null}
            </>
          }
        />
      ) : (
        <StateBlock
          kind="empty"
          icon={Unplug}
          heading="Connect crawl logs"
          action={connectCrawl ?? undefined}
        />
      )}
      {crawlAvailable ? (
        <CrawlLogConnections open={open} onOpenChange={setOpen} headerWhenEmpty={false} />
      ) : null}
    </>
  );
}
