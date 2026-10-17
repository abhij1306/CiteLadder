'use client';

import { memo, useDeferredValue } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import type { LiveTurn } from '@/lib/agent/live-turns';
import { ContentMarkdown } from '@/lib/markdown/markdown';

/**
 * The thinking summary, reply and document as they are written. The saved
 * reply replaces all of them, so the thinking summary closes with the turn.
 */
export function LiveReply({ live: latest }: Readonly<{ live: LiveTurn | undefined }>) {
  const live = useDeferredValue(latest);
  if (!live) return null;
  const { thinking, reply, document } = live;
  if (!thinking && !reply && !document) return null;
  return (
    <article aria-label="Agent reply in progress" aria-busy="true" className="grid gap-2">
      <span className={textRole('label')}>Agent</span>
      {thinking?.text ? (
        <Disclosure title="Thinking">
          <p className={textRole('caption', 'whitespace-pre-wrap')}>{thinking.text}</p>
        </Disclosure>
      ) : null}
      {reply?.text ? <ContentMarkdown markdown={reply.text} density="compact" /> : null}
      {document?.body ? <LiveDocument title={document.title} body={document.body} /> : null}
    </article>
  );
}

/** Memoized, so reply and thinking deltas do not re-render the document's Markdown. */
const LiveDocument = memo(function LiveDocument({
  title,
  body,
}: Readonly<{ title: string | null; body: string }>) {
  return (
    <section
      aria-label={title ? `Writing ${title}` : 'Writing the document'}
      className={panelClasses({}, 'grid min-w-0 gap-2')}
    >
      <span className={textRole('caption')}>Writing…</span>
      {title ? <h2 className={textRole('sectionTitle')}>{title}</h2> : null}
      <ContentMarkdown markdown={body} />
    </section>
  );
});
