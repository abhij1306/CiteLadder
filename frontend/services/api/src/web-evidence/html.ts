/** One parsed HTML tree shared by discovery, source inspection and page analysis. */
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

export type HtmlNode = DefaultTreeAdapterTypes.Node;
export type HtmlElement = DefaultTreeAdapterTypes.Element;
export type HtmlText = DefaultTreeAdapterTypes.TextNode;
const excluded = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe']);
/** A `<meta charset>` declared early in the document; the header charset still wins. */
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/iu;
const SNIFF_BYTES = 1024;

function decoder(label: string | undefined) {
  if (!label) return undefined;
  try {
    return new TextDecoder(label);
  } catch {
    return undefined;
  }
}
export function document(body: Buffer, charset = '') {
  const declared = META_CHARSET.exec(body.subarray(0, SNIFF_BYTES).toString('latin1'))?.[1];
  return parse((decoder(charset) ?? decoder(declared) ?? new TextDecoder('utf-8')).decode(body));
}
export const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node;
const isText = (node: HtmlNode): node is HtmlText => node.nodeName === '#text';
/**
 * Pushes `items` last-first so the stack pops them in order. A loop, not a
 * spread: an element with very many children must not exceed the engine's
 * argument limit.
 */
function pushReversed<T, U>(stack: U[], items: readonly T[], map: (item: T) => U) {
  for (let index = items.length - 1; index >= 0; index--) stack.push(map(items[index]!));
}
const same = <T>(item: T) => item;
/** Elements in document order, the root first when it is one. Template content is not traversed. */
export function* elements(root: HtmlNode, tag?: string): Generator<HtmlElement> {
  const pending: HtmlNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node) && (!tag || node.tagName === tag)) yield node;
    if ('childNodes' in node) pushReversed(pending, node.childNodes, same);
  }
}
const isTemplate = (node: HtmlElement): node is DefaultTreeAdapterTypes.Template =>
  node.tagName === 'template' && 'content' in node;
/**
 * Every anchor in document order, template content included, flagged when it
 * sits in template content. Crawlers follow these links, so discovery and the
 * link graph both read this one list. Iterative, so nesting depth never
 * reaches the call stack.
 */
export function* anchorElements(
  root: HtmlNode,
): Generator<{ anchor: HtmlElement; inTemplate: boolean }> {
  const pending: { node: HtmlNode; inTemplate: boolean }[] = [{ node: root, inTemplate: false }];
  while (pending.length) {
    const { node, inTemplate } = pending.pop()!;
    if (isElement(node) && node.tagName === 'a') yield { anchor: node, inTemplate };
    const content = isElement(node) && isTemplate(node) ? node.content : null;
    let children: readonly HtmlNode[] = [];
    if (content) children = content.childNodes;
    else if ('childNodes' in node) children = node.childNodes;
    const nested = inTemplate || content !== null;
    pushReversed(pending, children, (child) => ({ node: child, inTemplate: nested }));
  }
}
/** Text nodes in document order. */
export function* textNodes(root: HtmlNode): Generator<HtmlText> {
  const pending: HtmlNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isText(node)) yield node;
    if ('childNodes' in node) pushReversed(pending, node.childNodes, same);
  }
}
export const attribute = (node: HtmlElement, name: string) =>
  node.attrs.find((a) => a.name === name)?.value ?? '';
export const hasAttribute = (node: HtmlElement, name: string) =>
  node.attrs.some((a) => a.name === name);
export function parentElement(node: HtmlNode): HtmlElement | null {
  const parent = 'parentNode' in node ? node.parentNode : null;
  return parent && isElement(parent) ? parent : null;
}
export function* ancestors(node: HtmlNode): Generator<HtmlElement> {
  for (let current = parentElement(node); current; current = parentElement(current)) yield current;
}
export const childElements = (node: HtmlElement) => node.childNodes.filter(isElement);
/** Every descendant text concatenated, like the DOM's `textContent`, then trimmed. */
export function textContent(root: HtmlNode): string {
  let text = '';
  for (const node of textNodes(root)) text += node.value;
  return text.trim();
}
export function visibleText(root: HtmlNode, prune = true): string {
  const fragments: string[] = [];
  const pending: HtmlNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node) && prune && excluded.has(node.tagName)) continue;
    if (isText(node)) fragments.push(node.value);
    if ('childNodes' in node) pushReversed(pending, node.childNodes, same);
  }
  return fragments.join(' ').replaceAll(/\s+/gu, ' ').trim();
}
/** The visible text of an HTML fragment (a stored description body): entities decoded, scripts dropped. */
export const fragmentText = (html: string) => visibleText(parseFragment(html));
/**
 * The URL a document's relative links resolve against, as browsers resolve
 * them: the first `<base>` with an `href`, itself resolved against the
 * document URL, else the document URL. An unusable or non-web base is ignored.
 */
export function documentBaseUrl(root: HtmlNode, documentUrl: string): string {
  for (const base of elements(root, 'base')) {
    if (!hasAttribute(base, 'href')) continue;
    try {
      const resolved = new URL(attribute(base, 'href').trim(), documentUrl);
      return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : documentUrl;
    } catch {
      return documentUrl;
    }
  }
  return documentUrl;
}
