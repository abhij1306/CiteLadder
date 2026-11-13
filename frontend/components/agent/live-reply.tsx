import { memo, useDeferredValue } from 'react';

import { AgentTurn } from '@/components/ui/chat-dock';
import { Disclosure } from '@/components/ui/disclosure';
import { Stack } from '@/components/ui/layout';
import { cardClasses } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import type { LiveTurn } from '@/lib/agent/live-turns';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { cn } from '@/lib/utils';

/**
 * The thinking summary, reply and document as they are written. The saved
 * reply replaces all of them, so the thinking summary closes with the turn.
 */
export function LiveReply({ live: latest }: Readonly<{ live: LiveTurn | undefined }>) {
  const live = useDeferredValue(latest);
  // The turn's sources are known once it is saved; until then only the
  // project's own hosts open directly.
  const knownHosts = useAgentLinkHosts();
  if (!live) return null;
  const { thinking, reply, document } = live;
  if (!thinking && !reply && !document) return null;
  return (
    <AgentTurn inProgress>
      {thinking?.text ? (
        <Disclosure title="Thinking">
          <p className={textRole('caption', 'whitespace-pre-wrap')}>{thinking.text}</p>
        </Disclosure>
      ) : null}
      {reply?.text ? (
        <ContentMarkdown markdown={reply.text} density="compact" knownHosts={knownHosts} />
      ) : null}
      {document?.body ? (
        <LiveDocument title={document.title} body={document.body} knownHosts={knownHosts} />
      ) : null}
    </AgentTurn>
  );
}

/** Memoized, so reply and thinking deltas do not re-render the document's Markdown. */
const LiveDocument = memo(function LiveDocument({
  title,
  body,
  knownHosts,
}: Readonly<{ title: string | null; body: string; knownHosts: readonly string[] }>) {
  return (
    <Stack
      as="section"
      gap="compact"
      aria-label={title ? `Writing ${title}` : 'Writing the document'}
      className={cn(cardClasses(), 'min-w-0')}
    >
      <span className={textRole('caption')}>Writing…</span>
      {title ? <h2 className={textRole('sectionTitle')}>{title}</h2> : null}
      <ContentMarkdown markdown={body} knownHosts={knownHosts} />
    </Stack>
  );
});
