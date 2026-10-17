/**
 * Sanitised Markdown renderer for AI-generated content (Content vertical).
 *
 * The model output is UNTRUSTED. Defences, all local to this module:
 *   - raw HTML is never parsed (no `rehype-raw`; react-markdown escapes it),
 *   - URLs pass `safeUrlTransform` (./safe-url) — only http/https/mailto survive
 *     (`javascript:`/`data:`/etc. are neutralised to an empty href),
 *   - links open in a new tab with `rel="noopener noreferrer"`,
 *   - a restricted component map (no images, no iframes) with token-only
 *     classes so the output inherits the app theme.
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import { highlightPlugin, type Highlight } from './highlight';
import { safeUrlTransform } from './safe-url';

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
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** Render untrusted Markdown safely (GFM tables/lists, no raw HTML). */
export function ContentMarkdown({
  markdown,
  density = 'default',
  highlights = [],
}: Readonly<{
  markdown: string;
  density?: 'default' | 'compact';
  /** Exact phrases to mark where they appear whole inside one text run. */
  highlights?: readonly Highlight[];
}>) {
  const content = markdown ?? '';
  return (
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
}
