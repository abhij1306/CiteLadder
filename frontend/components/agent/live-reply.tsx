import { memo } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { textRole } from '@/components/ui/typography';
import type { LiveTurn } from '@/lib/agent/live-turns';
import { AGENT_STREAM_REPAINT_MS } from '@/lib/config/agent';
import { useAdaptiveThrottle } from '@/lib/use-adaptive-throttle';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { DraftSheet } from '@/components/ui/draft-sheet';

export function LiveReply({ live: latest }: Readonly<{ live: LiveTurn | undefined }>) {
  const live = useAdaptiveThrottle(latest, AGENT_STREAM_REPAINT_MS);
  const knownHosts = useAgentLinkHosts();
  if (!live) return null;
  const { thinking, reply, document } = live;
  const thought = thinking
    .map((segment) => segment.text)
    .filter(Boolean)
    .join('\n\n');
  return (
    <>
      {thought ? (
        <Disclosure title="Thinking">
          <p className={textRole('caption', 'whitespace-pre-wrap')}>{thought}</p>
        </Disclosure>
      ) : null}
      {reply.map((segment) =>
        segment.text ? (
          <ReplySegment key={segment.ordinal} text={segment.text} knownHosts={knownHosts} />
        ) : null,
      )}
      {document?.body ? (
        <LiveDocument title={document.title} body={document.body} knownHosts={knownHosts} />
      ) : null}
    </>
  );
}

const ReplySegment = memo(function ReplySegment({
  text,
  knownHosts,
}: Readonly<{ text: string; knownHosts: readonly string[] }>) {
  return <ContentMarkdown markdown={text} density="compact" knownHosts={knownHosts} />;
});

const LiveDocument = memo(function LiveDocument({
  title,
  body,
  knownHosts,
}: Readonly<{ title: string | null; body: string; knownHosts: readonly string[] }>) {
  return (
    <section aria-label={title ? `Writing ${title}` : 'Writing the document'} className="min-w-0">
      <DraftSheet as="div" state="draft" marker="Draft · writing">
        {title ? <h2 className={textRole('heading')}>{title}</h2> : null}
        <ContentMarkdown markdown={body} knownHosts={knownHosts} />
      </DraftSheet>
    </section>
  );
});
