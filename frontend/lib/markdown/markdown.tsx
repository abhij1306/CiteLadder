/**
 * Sanitised Markdown renderer for AI-generated content (Content vertical).
 *
 * The model output is UNTRUSTED. Defences, all local to this module:
 *   - raw HTML is never parsed (no `rehype-raw`; react-markdown escapes it),
 *   - URLs pass `safeUrlTransform` (./safe-url) — only http/https/mailto survive
 *     (`javascript:`/`data:`/etc. are neutralised to an empty href),
 *   - links open in a new tab with `rel="noopener noreferrer"`; given
 *     `knownHosts`, a link to any other host first asks the person to confirm
 *     the full address (a prompt-injected page can make the model put project
 *     data in a link),
 *   - a restricted component map (no images, no iframes) with token-only
 *     classes so the output inherits the app theme.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfirmDialog } from '@/components/ui/dialog';
import { Stack } from '@/components/ui/layout';
import { InlineFigure } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

import { highlightPlugin, type Highlight } from './highlight';
import { leavesForUnknownHost, safeUrlTransform } from './safe-url';

type LeaveGuard = Readonly<{
  knownHosts: readonly string[];
  confirmLeave: (href: string) => void;
}>;

/** Set only by a `ContentMarkdown` given `knownHosts`; links read it to decide. */
const LeaveGuardContext = createContext<LeaveGuard | null>(null);

function MarkdownLink({
  node: _node,
  children,
  href,
  ...props
}: Readonly<ComponentPropsWithoutRef<'a'> & ExtraProps>) {
  const guard = useContext(LeaveGuardContext);
  const confirm =
    guard !== null && href !== undefined && leavesForUnknownHost(href, guard.knownHosts);
  // Ctrl/Cmd/Shift-click fire `click`; a middle click fires only `auxclick`.
  const intercept = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    guard?.confirmLeave(href ?? '');
  };
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={confirm ? intercept : undefined}
      onAuxClick={confirm ? intercept : undefined}
    >
      {children}
    </a>
  );
}

/** Restricted component map (no props closed over, so it is stable across renders). */
const MARKDOWN_COMPONENTS: Components = {
  // Generated headings begin below the route-owned page title. The raw
  // Markdown remains untouched for copy and export.
  h1: ({ node: _node, children, ...props }) => <h2 {...props}>{children}</h2>,
  h2: ({ node: _node, children, ...props }) => <h3 {...props}>{children}</h3>,
  h3: ({ node: _node, children, ...props }) => <h4 {...props}>{children}</h4>,
  h4: ({ node: _node, children, ...props }) => <h5 {...props}>{children}</h5>,
  h5: ({ node: _node, children, ...props }) => <h6 {...props}>{children}</h6>,
  h6: ({ node: _node, children, ...props }) => <h6 {...props}>{children}</h6>,
  // Untrusted output: never render images (remote-fetch beacon risk).
  img: () => null,
  table: ({ node: _node, ...props }) => (
    <div className="prose-table-frame">
      <table {...props} />
    </div>
  ),
  // Forward the remaining DOM props (id, aria-describedby,
  // data-footnote-*) so GFM footnote back-links keep working; `node`
  // is react-markdown's AST handle, not a DOM attribute.
  a: MarkdownLink,
};

/** Render untrusted Markdown safely (GFM tables/lists, no raw HTML). */
export function ContentMarkdown({
  markdown,
  density = 'default',
  highlights = [],
  knownHosts,
}: Readonly<{
  markdown: string;
  density?: 'default' | 'compact';
  /** Exact phrases to mark where they appear whole inside one text run. */
  highlights?: readonly Highlight[];
  /**
   * Hosts a link may open directly (each also covers its subdomains); a link
   * anywhere else opens only after a "You're leaving CiteLadder" confirm that
   * shows its full address. Omitted, every link opens directly.
   */
  knownHosts?: readonly string[];
}>) {
  const content = markdown ?? '';
  const [leaving, setLeaving] = useState<string | null>(null);
  const guard = useMemo<LeaveGuard | null>(
    () => (knownHosts ? { knownHosts, confirmLeave: setLeaving } : null),
    [knownHosts],
  );
  const body = (
    // Generated Markdown can contain unbreakable URLs, code, and wide tables.
    // Text wraps to the column; a table that still cannot fit scrolls inside
    // its own frame, never as one scrollbar at the bottom of a long result.
    <div
      className={cn(
        'prose-content min-w-0 w-full max-w-full [overflow-wrap:anywhere]',
        density === 'compact' && 'prose-compact',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlights.length ? [highlightPlugin(highlights)] : []}
        urlTransform={safeUrlTransform}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
  if (!guard) return body;
  return (
    <LeaveGuardContext.Provider value={guard}>
      {body}
      <ConfirmDialog
        request={
          leaving === null
            ? null
            : {
                title: 'You’re leaving CiteLadder',
                body: (
                  <Stack gap="tight">
                    <p>
                      This link goes to an address that is not your project’s site or a cited
                      source. Check the full address before you open it.
                    </p>
                    <p className="text-ink [overflow-wrap:anywhere]">
                      <InlineFigure>{leaving}</InlineFigure>
                    </p>
                  </Stack>
                ),
                confirmLabel: 'Open link',
                onConfirm: () => {
                  window.open(leaving, '_blank', 'noopener,noreferrer');
                  setLeaving(null);
                },
              }
        }
        onCancel={() => setLeaving(null)}
      />
    </LeaveGuardContext.Provider>
  );
}
