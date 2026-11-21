import type { HtmlElement, HtmlNode } from '../../web-evidence/html.ts';
import { ancestors, isElement, parentElement } from '../../web-evidence/html.ts';
import { analysisPolicy, limits } from './policy.ts';

type ReferenceSnippet = { html: string; truncated: boolean };

const KEPT = new Set(analysisPolicy.facts.reference_snippet_kept_attributes);
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);
const SHELLS = new Set(['svg', 'math']);
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const ATTRIBUTE_NAME = /^[a-z][a-z0-9_.:-]*$/iu;
const EMAIL = /[^\s@]@[^\s@.]+\.[^\s@]/u;
const TOKEN_RUN = /[\w+/=-]{24,}/gu;
const REDACTED = '[redacted]';
const TEXT = '[text]';

const looksLikeToken = (value: string) =>
  (value.match(TOKEN_RUN) ?? []).some((run) => /\d/u.test(run) && /[a-z]/iu.test(run));

const escapeValue = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function attributeValue(name: string, value: string) {
  if (!KEPT.has(name) || EMAIL.test(value) || looksLikeToken(value)) return REDACTED;
  return escapeValue(Array.from(value).slice(0, limits.accessibility_identifier_chars).join(''));
}

function openTag(node: HtmlElement) {
  const parts = [node.tagName];
  for (const { name, value } of node.attrs) {
    const lower = name.toLowerCase();
    if (!ATTRIBUTE_NAME.test(name) || lower.startsWith('on')) continue;
    parts.push(value === '' ? lower : `${lower}="${attributeValue(lower, value)}"`);
  }
  return `<${parts.join(' ')}>`;
}

type Pending = HtmlNode | { close: string };

function emit(item: Pending, pending: Pending[]): string {
  if ('close' in item) return item.close;
  if (item.nodeName === '#text') return 'value' in item && item.value.trim() ? TEXT : '';
  if (!isElement(item) || DROPPED.has(item.tagName)) return '';
  if (VOID.has(item.tagName)) return openTag(item);
  pending.push({ close: `</${item.tagName}>` });
  if (!SHELLS.has(item.tagName)) {
    for (let index = item.childNodes.length - 1; index >= 0; index--)
      pending.push(item.childNodes[index]!);
  }
  return openTag(item);
}

function serialize(root: HtmlElement, budget = Infinity) {
  let html = '';
  const pending: Pending[] = [root];
  while (pending.length && html.length <= budget) html += emit(pending.pop()!, pending);
  return html;
}

export function referenceSnippet(control: HtmlElement): ReferenceSnippet {
  const cap = limits.reference_snippet_chars;
  const context = [...ancestors(control)].find((node) => node.tagName === 'label');
  const parent = context ?? parentElement(control);
  for (const candidate of parent ? [parent, control] : [control]) {
    const html = serialize(candidate, cap);
    if (html.length <= cap) return { html, truncated: false };
  }
  return { html: Array.from(serialize(control, cap)).slice(0, cap).join(''), truncated: true };
}
