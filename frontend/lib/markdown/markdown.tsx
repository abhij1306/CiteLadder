import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfirmDialog } from '@/components/ui/dialog';
import { Stack } from '@/components/ui/layout';
import { useScrollFrame } from '@/components/ui/scroll-edges';
import { InlineFigure } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

import { highlightPlugin, type Highlight } from './highlight';
import { phraseChipsPlugin } from './phrase-chips';
import { leavesForUnknownHost, safeUrlTransform } from './safe-url';

const NO_CHIPS: readonly PhraseChip[] = [];

type LeaveGuard = Readonly<{
  knownHosts: readonly string[];
  confirmLeave: (href: string) => void;
}>;

const LeaveGuardContext = createContext<LeaveGuard | null>(null);

export type LinkChip = (href: string, children: ReactNode) => ReactNode | null;

const LinkChipContext = createContext<LinkChip | null>(null);

function MarkdownLink({
  node: _node,
  children,
  href,
  ...props
}: Readonly<ComponentPropsWithoutRef<'a'> & ExtraProps>) {
  const guard = useContext(LeaveGuardContext);
  const chip = useContext(LinkChipContext)?.(href ?? '', children) ?? null;
  const confirm =
    guard !== null && href !== undefined && leavesForUnknownHost(href, guard.knownHosts);
  // Ctrl/Cmd/Shift-click fire `click`; a middle click fires only `auxclick`.
  const intercept = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    guard?.confirmLeave(href ?? '');
  };
  if (chip !== null) return <>{chip}</>;
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

export type PhraseChip = Readonly<{ text: string; node: ReactNode }>;

const ChipsContext = createContext<readonly PhraseChip[]>([]);

function MarkdownSpan({
  node: _node,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'> & ExtraProps & { 'data-chip'?: string }>) {
  const chips = useContext(ChipsContext);
  const chip = props['data-chip'] === undefined ? undefined : chips[Number(props['data-chip'])];
  if (chip) return <>{chip.node}</>;
  return <span {...props}>{children}</span>;
}

type HastNode = Readonly<{ type: string; tagName?: string; value?: string; children?: HastNode[] }>;

function hastText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

function hastHeads(node: HastNode): string[] {
  if (node.tagName === 'th') return [hastText(node).trim()];
  return (node.children ?? []).flatMap(hastHeads);
}

function tableName(node: HastNode | undefined): string {
  const heads = node ? hastHeads(node).filter(Boolean) : [];
  if (heads.length === 0) return 'Table';
  const shown = heads.slice(0, 3).join(', ');
  return `Table: ${shown}${heads.length > 3 ? ', …' : ''}`;
}

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ node: _node, children, ...props }) => <h2 {...props}>{children}</h2>,
  h2: ({ node: _node, children, ...props }) => <h3 {...props}>{children}</h3>,
  h3: ({ node: _node, children, ...props }) => <h4 {...props}>{children}</h4>,
  h4: ({ node: _node, children, ...props }) => <h5 {...props}>{children}</h5>,
  h5: ({ node: _node, children, ...props }) => <h6 {...props}>{children}</h6>,
  h6: ({ node: _node, children, ...props }) => <h6 {...props}>{children}</h6>,
  // Untrusted output: never render images (remote-fetch beacon risk).
  img: () => null,
  table: ({ node, ...props }) => <MarkdownTable name={tableName(node)} {...props} />,
  th: ({ node: _node, ...props }) => <th {...props} scope="col" />,
  // Forward the remaining DOM props (id, aria-describedby,
  // data-footnote-*) so GFM footnote back-links keep working; `node`
  // is react-markdown's AST handle, not a DOM attribute.
  a: MarkdownLink,
  // Markdown never makes a span (raw HTML is escaped); only chip slots do.
  span: MarkdownSpan,
};

function MarkdownTable({
  name,
  ...props
}: Readonly<{ name: string } & ComponentPropsWithoutRef<'table'>>) {
  const { ref, region, frame } = useScrollFrame({ label: name });
  return (
    <div {...frame} className="prose-table-frame grid min-w-0">
      <div ref={ref} {...region} className="overflow-x-auto">
        <table {...props} aria-label={name} />
      </div>
    </div>
  );
}

type MarkdownBodyProps = Readonly<{
  content: string;
  density: 'default' | 'compact';
  chipTexts: readonly string[];
  highlights: readonly Highlight[];
}>;

function sameItems<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean) {
  return (
    a.length === b.length &&
    a.every((item, i) => {
      const other = b[i];
      return other !== undefined && same(item, other);
    })
  );
}

function sameBody(a: MarkdownBodyProps, b: MarkdownBodyProps) {
  return (
    a.content === b.content &&
    a.density === b.density &&
    sameItems(a.chipTexts, b.chipTexts, (x, y) => x === y) &&
    sameItems(a.highlights, b.highlights, (x, y) => x.text === y.text && x.tone === y.tone)
  );
}

const MarkdownBody = memo(function MarkdownBody({
  content,
  density,
  chipTexts,
  highlights,
}: MarkdownBodyProps) {
  return (
    <div
      className={cn(
        'prose-content min-w-0 w-full max-w-full [overflow-wrap:anywhere]',
        density === 'compact' && 'prose-compact',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          ...(chipTexts.length ? [phraseChipsPlugin(chipTexts)] : []),
          ...(highlights.length ? [highlightPlugin(highlights)] : []),
        ]}
        urlTransform={safeUrlTransform}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, sameBody);

export function ContentMarkdown({
  markdown,
  density = 'default',
  highlights = [],
  chips = NO_CHIPS,
  knownHosts,
  linkChip,
}: Readonly<{
  markdown: string;
  density?: 'default' | 'compact';
  highlights?: readonly Highlight[];
  chips?: readonly PhraseChip[];
  knownHosts?: readonly string[];
  linkChip?: LinkChip;
}>) {
  const content = markdown ?? '';
  const [leaving, setLeaving] = useState<string | null>(null);
  const guard = useMemo<LeaveGuard | null>(
    () => (knownHosts ? { knownHosts, confirmLeave: setLeaving } : null),
    [knownHosts],
  );
  const body = (
    <MarkdownBody
      content={content}
      density={density}
      chipTexts={chips.map((chip) => chip.text)}
      highlights={highlights}
    />
  );
  const phrased = chips.length ? (
    <ChipsContext.Provider value={chips}>{body}</ChipsContext.Provider>
  ) : (
    body
  );
  const chipped = linkChip ? (
    <LinkChipContext.Provider value={linkChip}>{phrased}</LinkChipContext.Provider>
  ) : (
    phrased
  );
  if (!guard) return chipped;
  return (
    <LeaveGuardContext.Provider value={guard}>
      {chipped}
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

const asParagraph: Components['p'] = ({ children }) => <p>{children}</p>;
const asCell: Components['td'] = ({ children }) => <>{children} </>;
const TEXT_ELEMENTS = [
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'th',
  'td',
];
const TEXT_COMPONENTS: Components = {
  h1: asParagraph,
  h2: asParagraph,
  h3: asParagraph,
  h4: asParagraph,
  h5: asParagraph,
  h6: asParagraph,
  tr: asParagraph,
  th: asCell,
  td: asCell,
};

export const MarkdownText = memo(function MarkdownText({
  markdown,
}: Readonly<{ markdown: string }>) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={TEXT_ELEMENTS}
      unwrapDisallowed
      components={TEXT_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  );
});
