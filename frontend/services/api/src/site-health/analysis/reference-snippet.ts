/**
 * A bounded, redacted HTML reference snippet of one failing element with its
 * label context, so a fix can name the exact markup without the crawler
 * keeping raw HTML.
 *
 * The snippet keeps structure only: tags, attribute names, and the values of
 * the structural attributes configured in `reference_snippet_kept_attributes`
 * (never an email- or token-like one). Every other attribute value, all text,
 * comments, event handlers and script-like elements are removed, so the page's
 * copy and anything a visitor could have typed never reach it.
 */
import type { HtmlElement, HtmlNode } from '../../web-evidence/html.ts';
import { ancestors, isElement, parentElement } from '../../web-evidence/html.ts';
import { analysisPolicy, limits } from './policy.ts';

type ReferenceSnippet = { html: string; truncated: boolean };

const KEPT = new Set(analysisPolicy.facts.reference_snippet_kept_attributes);
/** Elements whose content is code or embedded documents: dropped whole. */
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);
/** Elements kept as an empty shell: their content is drawing data, not structure. */
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
/**
 * Linear-time shapes, since attribute values come from the crawled page: an
 * address (a character, `@`, a domain label and a dot), and a run of 24 or more
 * token characters, which is a token when it mixes letters and digits (an id,
 * hash, session or API token).
 */
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

/** The markup one pending item adds; an element queues its close tag and children. */
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

/**
 * The redacted markup of `root`, depth-first without recursion. It stops once
 * the markup passes `budget` characters, so a large context costs no more than
 * the cap.
 */
function serialize(root: HtmlElement, budget = Infinity) {
  let html = '';
  const pending: Pending[] = [root];
  while (pending.length && html.length <= budget) html += emit(pending.pop()!, pending);
  return html;
}

/**
 * The control within its label context: the wrapping label, else its parent
 * element. When that exceeds `reference_snippet_chars` the control alone, and
 * when even that does, the control cut at the cap and marked truncated.
 */
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
