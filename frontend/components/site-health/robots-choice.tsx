import { useState } from 'react';
import type { CrawlRobotsChoice, CrawlRobotsHandling } from '@citeladder/contracts';

import { StatusMark } from '@/components/ui/status-mark';
import { ActionButton } from '@/components/ui/actions';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/dialog';
import { MenuItem } from '@/components/ui/menu';
import { SPLIT_ACTION_JOIN, SplitButton } from '@/components/ui/split-button';
import { Tooltip } from '@/components/ui/tooltip';

export function RobotsExcludedBadge() {
  return (
    <Tooltip content="Fetched because the crawl ignored robots.txt.">
      <StatusMark tone="warning">Robots.txt excluded</StatusMark>
    </Tooltip>
  );
}

export function robotsChoiceNote(choice: CrawlRobotsChoice | undefined) {
  if (choice?.handling !== 'ignore') return null;
  return choice.decided_by_email
    ? `Ignores robots.txt (confirmed by ${choice.decided_by_email})`
    : 'Ignores robots.txt';
}

export function StartCrawlControl({
  siteUrl,
  robots,
  pending,
  onStart,
}: Readonly<{
  siteUrl: string;
  robots: CrawlRobotsChoice;
  pending: boolean;
  onStart: (robots?: CrawlRobotsHandling) => void;
}>) {
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const note = robotsChoiceNote(robots);
  const askToIgnore = () =>
    setConfirm({
      title: 'Ignore robots.txt for this crawl?',
      body: (
        <>
          Also fetches pages on {siteUrl} that robots.txt disallows. Only if you are authorized to
          crawl this site. Later and scheduled crawls keep this choice.
        </>
      ),
      confirmLabel: 'I am authorized, run crawl',
      onConfirm: () => {
        setConfirm(null);
        onStart('ignore');
      },
    });
  const button = (
    <ActionButton
      action="runCrawl"
      onClick={() => onStart()}
      pending={pending}
      pendingLabel="Starting…"
      style={SPLIT_ACTION_JOIN}
    />
  );
  return (
    <>
      <SplitButton
        action={note ? <Tooltip content={`${note}.`}>{button}</Tooltip> : button}
        menuLabel="More crawl options"
        disabled={pending}
      >
        {note ? (
          <MenuItem onSelect={() => onStart('respect')}>Respect robots.txt</MenuItem>
        ) : (
          <MenuItem onSelect={askToIgnore}>Ignore robots.txt</MenuItem>
        )}
      </SplitButton>
      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
    </>
  );
}
