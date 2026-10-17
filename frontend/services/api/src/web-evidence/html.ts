/** One parsed HTML tree shared by discovery, source inspection and page analysis. */
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

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
const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node;
const isText = (node: HtmlNode): node is HtmlText => node.nodeName === '#text';
/** Elements in document order, the root first when it is one. Template content is not traversed. */
export function* elements(root: HtmlNode, tag?: string): Generator<HtmlElement> {
  const pending: HtmlNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node) && (!tag || node.tagName === tag)) yield node;
    if ('childNodes' in node) pending.push(...node.childNodes.toReversed());
  }
}
/** Text nodes in document order. */
export function* textNodes(root: HtmlNode): Generator<HtmlText> {
  const pending: HtmlNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (isText(node)) yield node;
    if ('childNodes' in node) pending.push(...node.childNodes.toReversed());
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
    if ('childNodes' in node) pending.push(...node.childNodes.toReversed());
  }
  return fragments.join(' ').replaceAll(/\s+/gu, ' ').trim();
}
