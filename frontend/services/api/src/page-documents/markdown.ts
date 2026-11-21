import { serialize, type DefaultTreeAdapterTypes } from 'parse5';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import type { PageFields } from '../agent/outputs.ts';
import { policy } from '../config.ts';
import { pageScope, regionNodeIsVisible } from '../site-health/analysis/regions.ts';
import { extractSourcePage } from '../source-pages/extract.ts';
import {
  attribute,
  document,
  elements,
  textContent,
  visibleText,
  type HtmlElement,
  type HtmlNode,
} from '../web-evidence/html.ts';

const limits = policy.content_optimization.page_document;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

export type PageReading =
  | { kind: 'document'; title: string; body: string; fields: PageFields }
  | { kind: 'no_content' }
  | { kind: 'too_long'; chars: number };

const URL_ATTRIBUTES = new Set(['href', 'src']);
const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node;

function absolute(value: string, base: string) {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function copyOf(node: ChildNode, base: string): ChildNode {
  if (!isElement(node)) return { ...node, parentNode: null };
  return {
    ...node,
    attrs: node.attrs.map((attr) =>
      URL_ATTRIBUTES.has(attr.name) ? { ...attr, value: absolute(attr.value, base) } : attr,
    ),
    childNodes: [],
    parentNode: null,
  };
}

function isKept(child: ChildNode, cards: ReadonlySet<HtmlElement>) {
  if (child.nodeName === '#comment' || child.nodeName === '#documentType') return false;
  return !isElement(child) || (!cards.has(child) && regionNodeIsVisible(child));
}

function keptRegion(region: HtmlNode, cards: ReadonlySet<HtmlElement>, base: string): ParentNode {
  const root: ParentNode = { nodeName: '#document-fragment', childNodes: [] };
  const pending: [HtmlNode, ParentNode][] = [[region, root]];
  while (pending.length) {
    const [source, target] = pending.pop()!;
    if (!('childNodes' in source)) continue;
    for (const child of source.childNodes) {
      if (!isKept(child, cards)) continue;
      const copy = copyOf(child, base);
      target.childNodes.push(copy);
      if (isElement(child) && 'childNodes' in copy) pending.push([child, copy]);
    }
  }
  return root;
}

const toMarkdown = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', emphasis: '_', fences: true, rule: '-' });

function jsonLd(root: HtmlNode) {
  const blocks: string[] = [];
  let size = 0;
  for (const node of elements(root, 'script')) {
    if (!attribute(node, 'type').toLowerCase().includes('ld+json')) continue;
    const block = textContent(node);
    if (!block) continue;
    if (size + block.length > limits.json_ld_max_chars) break;
    blocks.push(block);
    size += block.length + 2;
  }
  return blocks.join('\n\n');
}

function documentTitle(fields: PageFields, root: HtmlNode, finalUrl: string) {
  const heading = elements(root, 'h1').next().value;
  const title = fields.title || (heading ? visibleText(heading) : '') || finalUrl;
  return title.slice(0, limits.title_max_chars).trim();
}

export function readPageDocument(
  body: Buffer,
  page: { finalUrl: string; charset?: string },
): PageReading {
  const root = document(body, page.charset);
  const scope = pageScope(root, page.finalUrl);
  const html = serialize(keptRegion(scope.region, scope.cards, page.finalUrl));
  const markdown = String(toMarkdown.processSync(html)).trim();
  if (!markdown) return { kind: 'no_content' };
  if (markdown.length > limits.body_max_chars) return { kind: 'too_long', chars: markdown.length };
  const { facts } = extractSourcePage(body, page.charset);
  const fields = {
    title: facts.title,
    meta_description: facts.meta_description,
    json_ld: jsonLd(root),
  };
  return {
    kind: 'document',
    title: documentTitle(fields, root, page.finalUrl),
    body: markdown,
    fields,
  };
}
