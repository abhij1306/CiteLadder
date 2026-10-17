/** Excludes metadata (bylines, dates, badges) and calls to action from page prose. */
import {
  attribute,
  elements,
  parentElement,
  textContent,
  type HtmlElement,
} from '../../web-evidence/html.ts';
import { analysisPolicy, squash, words } from './policy.ts';

const authorship = analysisPolicy.facts.authorship;
export const NEXT_ACTION =
  /\b(?:apply|book|buy|contact|get started|join|register|request|schedule|sign up|start|subscribe|talk to|try)\b/iu;
const BYLINE_AT_START = new RegExp(`^(?:${authorship.byline_pattern})`);
const BYLINE_SUFFIX = new RegExp(`^(?:${authorship.byline_metadata_suffix_pattern})$`, 'i');
const SHORT_DATE_SOURCE = authorship.short_date_pattern.replaceAll(
  String.raw`\d`,
  String.raw`\p{Nd}`,
);
const SHORT_DATE = new RegExp(`^(?:${SHORT_DATE_SOURCE})$`, 'iu');
const METADATA_TOKENS = new Set([
  'author',
  'badge',
  'breadcrumb',
  'byline',
  'date',
  'eyebrow',
  'kicker',
  'metadata',
  'published',
  'tag',
  'timestamp',
]);
export const CTA_TOKENS = new Set(analysisPolicy.facts.cta_button_role_tokens);
const GENERIC_ITEM_LABELS = new Set(analysisPolicy.facts.generic_item_link_labels);

/** A navigation action does not establish the linked item's identity. */
export const isGenericItemLabel = (value: string) =>
  GENERIC_ITEM_LABELS.has(squash(value).toLowerCase());

const attributeTokens = (node: HtmlElement) =>
  ['class', 'id', 'itemprop', 'rel', 'role']
    .map((name) => attribute(node, name))
    .join(' ')
    .toLowerCase()
    .match(/[a-z0-9]+/gu) ?? [];

function isMetadataCopy(text: string) {
  const byline = BYLINE_AT_START.exec(text);
  if (byline) {
    const suffix = text.slice(byline[0].length).trim();
    return !suffix || BYLINE_SUFFIX.test(suffix);
  }
  const lowered = text.toLowerCase();
  return (
    lowered.startsWith('published ') || lowered.startsWith('updated ') || SHORT_DATE.test(text)
  );
}

function hasMetadataAncestor(node: HtmlElement) {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (attributeTokens(current).some((token) => METADATA_TOKENS.has(token))) return true;
    current = parentElement(current);
  }
  return false;
}

function hasShortCtaDescendant(node: HtmlElement, text: string) {
  const controls = [...elements(node)].filter(
    (item) =>
      item !== node &&
      (item.tagName === 'a' ||
        item.tagName === 'button' ||
        (item.tagName === 'input' && attribute(item, 'type') === 'submit')),
  );
  if (!controls.length || words(text).length > 12) return false;
  return controls.some((item) => NEXT_ACTION.test(textContent(item)));
}

/** Whether a node's copy is metadata or a call to action rather than page prose. */
export function isMetadataOrCta(node: HtmlElement) {
  const text = squash(textContent(node));
  if (!text || isMetadataCopy(text)) return true;
  if (attributeTokens(node).some((token) => CTA_TOKENS.has(token))) return true;
  return hasMetadataAncestor(node) || hasShortCtaDescendant(node, text);
}
