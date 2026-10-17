/**
 * A rehype step that wraps exact phrases in `<mark>`. It only splits text
 * nodes, so it adds no HTML from the input and leaves code and links intact.
 * A phrase that crosses formatting (bold, a link) stays unmarked.
 */
export type Highlight = { text: string; tone: 'positive' | 'negative' };

type Text = { type: 'text'; value: string };
type Element = {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: Node[];
};
type Node = Text | Element | { type: string; children?: Node[] };

const TONE_CLASS: Record<Highlight['tone'], string> = {
  positive: 'bg-success-bg text-foreground',
  negative: 'bg-danger-bg text-foreground',
};
const SKIPPED = new Set(['code', 'pre']);

function isText(node: Node): node is Text {
  return node.type === 'text' && 'value' in node;
}

/** The text split around the earliest highlight, recursively. */
function splitText(value: string, highlights: readonly Highlight[]): Node[] {
  let best: { at: number; highlight: Highlight } | null = null;
  for (const highlight of highlights) {
    const at = value.indexOf(highlight.text);
    if (at !== -1 && (best === null || at < best.at)) best = { at, highlight };
  }
  if (best === null) return value ? [{ type: 'text', value }] : [];
  const end = best.at + best.highlight.text.length;
  return [
    ...(best.at ? [{ type: 'text', value: value.slice(0, best.at) } satisfies Text] : []),
    {
      type: 'element',
      tagName: 'mark',
      properties: { className: [TONE_CLASS[best.highlight.tone]] },
      children: [{ type: 'text', value: best.highlight.text }],
    } satisfies Element,
    ...splitText(value.slice(end), highlights),
  ];
}

function walk(node: Node, highlights: readonly Highlight[]): void {
  if (!('children' in node) || !node.children) return;
  if ('tagName' in node && SKIPPED.has(node.tagName)) return;
  node.children = node.children.flatMap((child) => {
    if (isText(child)) return splitText(child.value, highlights);
    walk(child, highlights);
    return [child];
  });
}

export function highlightPlugin(highlights: readonly Highlight[]) {
  const usable = highlights.filter((highlight) => highlight.text.trim());
  return () => (tree: Node) => walk(tree, usable);
}
