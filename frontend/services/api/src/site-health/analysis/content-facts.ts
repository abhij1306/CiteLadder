/** Bounded content and citability facts spoken by the primary content, not page chrome. */
import {
  ancestors,
  attribute,
  childElements,
  elements,
  textContent,
  textNodes,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { policy } from '../../config.ts';
import { CTA_TOKENS, isMetadataOrCta, NEXT_ACTION } from './copy.ts';
import { analysisPolicy, limits, regionPolicy, squash, words } from './policy.ts';
import { directAnswer, questionAnswerRelationships } from './questions.ts';
import {
  hasRichTextToken,
  pageOwned,
  regionNodeIsVisible,
  regionText,
  outsideContainers,
  type PageScope,
} from './regions.ts';

const facts = analysisPolicy.facts;
// Table bounds are the source-page differentiation policy, shared by design.
const tableBounds = policy.content_differentiation;
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// A capitalized name of up to six words, then a provider verb. Every
// quantifier is bounded, so matching stays linear in the sentence length.
const NAME = String.raw`[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5}`;
const OFFER_VERBS = String.raw`provides?|offers?|delivers?|builds?|manages?|specializes\s+in`;
const PROVIDER_VERBS = String.raw`${OFFER_VERBS}|measures?|turns?|brings\s+together|helps?|enables?`;
const PROVIDER = new RegExp(String.raw`^(?<provider>${NAME})\s+(?:${PROVIDER_VERBS})\s+`, 'u');
const PROVIDER_NAME = new RegExp(`^${NAME}$`, 'u');
const CAPABILITY = new RegExp(
  String.raw`\b(?:${OFFER_VERBS})\s+(?<capability>[^.,;]{3,160}?)(?=\s+(?:for|so|that|to)\b|[.,;]|$)`,
  'iu',
);
const AUDIENCE_OR_OUTCOME = [
  /\bfor\s+(?<value>[^.,;]{3,160})/iu,
  /\b(?:helps?|enables?|lets?)\s+(?<value>[^.,;]{3,160})/iu,
  /\bso\s+(?<value>[^.,;]{3,160})/iu,
];
const PROVIDER_EXCLUSIONS = new Set(facts.provider_identity_exclusions);

export function emptyContentFacts() {
  return {
    editorial_lead: '',
    direct_answer: '',
    primary_content_text: '',
    primary_content_pre_truncation_length: 0,
    primary_content_truncated: false,
    authored_content: false,
    entity_proposition: {
      identity: '',
      proposition: '',
      provider: '',
      named_capability: '',
      audience_or_outcome: '',
      next_action: '',
    },
    primary_heading_outline: [] as { level: number; text: string }[],
    primary_table_headers: [] as string[][],
    question_answer_relationships: [] as ReturnType<typeof questionAnswerRelationships>,
  };
}

type Owned = { region: HtmlNode; containers: ReadonlySet<HtmlElement> };
const owned = (node: HtmlElement, scope: Owned) => pageOwned(node, scope.region, scope.containers);

function* scannedElements(region: HtmlNode) {
  let scanned = 0;
  for (const node of elements(region)) {
    if (++scanned > regionPolicy.max_containers_scanned) return;
    yield node;
  }
}

function headingOutline(scope: Owned) {
  const outline: { level: number; text: string }[] = [];
  for (const node of elements(scope.region)) {
    if (!HEADINGS.has(node.tagName) || !owned(node, scope)) continue;
    const text = squash(textContent(node)).slice(0, limits.heading_chars);
    if (!text) continue;
    outline.push({ level: Number(node.tagName[1]), text });
    if (outline.length >= limits.headings_kept) break;
  }
  return outline;
}

function tableHeaders(scope: Owned) {
  const tables: string[][] = [];
  for (const table of elements(scope.region, 'table')) {
    if (!outsideContainers(table, scope.containers)) continue;
    tables.push(
      [...elements(table, 'th')]
        .map((node) => textContent(node).slice(0, 200))
        .filter((text) => text.trim())
        .slice(0, tableBounds.max_table_headers),
    );
    if (tables.length >= tableBounds.max_tables) break;
  }
  return tables;
}

function editorialLead(scope: Owned) {
  let seenIdentity = false;
  for (const node of scannedElements(scope.region)) {
    if (HEADINGS.has(node.tagName) && owned(node, scope)) {
      if (seenIdentity) return '';
      seenIdentity = node.tagName === 'h1' || node.tagName === 'h2';
      continue;
    }
    if (node.tagName !== 'p' || !seenIdentity) continue;
    if (!owned(node, scope) || isMetadataOrCta(node)) continue;
    const text = squash(textContent(node));
    if (words(text).length >= 5) return text.slice(0, limits.first_answer_chars);
  }
  return '';
}

function substantiveProposition(scope: Owned) {
  let scanned = 0;
  for (const paragraph of elements(scope.region, 'p')) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    if (!owned(paragraph, scope)) continue;
    const text = squash(textContent(paragraph));
    if (words(text).length >= facts.answer_first_min_words && !isMetadataOrCta(paragraph))
      return text.slice(0, limits.first_answer_chars);
  }
  return '';
}

function providerIdentity(proposition: string) {
  for (const sentence of proposition.trim().split(/(?<=[.!?])\s+/u)) {
    const provider = PROVIDER.exec(sentence)?.groups?.provider?.trim();
    if (provider && !PROVIDER_EXCLUSIONS.has(provider.toLowerCase())) return provider;
  }
  return '';
}

function addressIdentity(scope: Owned) {
  let scanned = 0;
  for (const address of elements(scope.region, 'address')) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    if (!owned(address, scope)) continue;
    const name = [...textNodes(address)].map((node) => squash(node.value)).find(Boolean) ?? '';
    if (PROVIDER_NAME.test(name)) return name;
  }
  return '';
}

function isCtaAnchor(node: HtmlElement) {
  if (attribute(node, 'role').trim().toLowerCase() === 'button') return true;
  const classes = attribute(node, 'class').toLowerCase();
  return Boolean(classes) && classes.split(/[\s_-]+/u).some((token) => CTA_TOKENS.has(token));
}

/** The path a call to action leads to; `mailto:`/`tel:` keep only their scheme. */
function actionPath(href: string) {
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(href)?.[1]?.toLowerCase();
  if (scheme === 'mailto' || scheme === 'tel') return `${scheme}:`;
  let rest = href;
  if (scheme) rest = href.slice(scheme.length + 1);
  if (rest.startsWith('//')) {
    const slash = rest.indexOf('/', 2);
    rest = slash === -1 ? '' : rest.slice(slash);
  }
  return rest.split(/[?#]/u)[0] ?? '';
}

function nextActionPath(scope: Owned) {
  let found = 0;
  for (const node of scannedElements(scope.region)) {
    if ((node.tagName !== 'a' && node.tagName !== 'form') || !owned(node, scope)) continue;
    if (++found > limits.cta_texts * 4) break;
    if (!NEXT_ACTION.test(squash(textContent(node))) && !isCtaAnchor(node)) continue;
    const href = (attribute(node, 'href') || attribute(node, 'action')).trim();
    if (!href || href.startsWith('#')) continue;
    const path = actionPath(href);
    if (path) return path;
  }
  return '';
}

function entityProposition(scope: Owned, proposition: string) {
  const provider = providerIdentity(proposition) || addressIdentity(scope);
  const capability = CAPABILITY.exec(proposition)?.groups?.capability ?? '';
  const statement = `${provider}. ${proposition}`;
  const audience =
    AUDIENCE_OR_OUTCOME.map((pattern) => pattern.exec(statement)?.groups?.value).find(
      (value) => value !== undefined,
    ) ?? '';
  return {
    identity: provider.slice(0, limits.heading_chars),
    proposition: proposition.slice(0, limits.first_answer_chars),
    provider: provider.slice(0, limits.heading_chars),
    named_capability: squash(capability).slice(0, limits.first_answer_chars),
    audience_or_outcome: squash(audience).slice(0, limits.first_answer_chars),
    next_action: nextActionPath(scope).slice(0, limits.url_chars),
  };
}

/** A prose article/rich-text body outside repeated items, independent of its URL or schema. */
function authoredContent(scope: Owned) {
  for (const node of scannedElements(scope.region)) {
    if ((node.tagName !== 'article' && !hasRichTextToken(node)) || !owned(node, scope)) continue;
    if (words(regionText(node, scope.containers)).length >= facts.server_rendered_min_words)
      return true;
  }
  return false;
}

/** Facts read from the primary region outside recommendation and non-prose card lists. */
export function contentFacts(page: PageScope) {
  const scope: Owned = {
    region: page.region,
    containers: page.cards,
  };
  const text = regionText(page.region, scope.containers);
  const lead = editorialLead(scope);
  const proposition =
    words(lead).length >= facts.answer_first_min_words ? lead : substantiveProposition(scope);
  return {
    editorial_lead: lead,
    direct_answer: directAnswer(scope),
    primary_content_text: text.slice(0, regionPolicy.page_owned_text_max_chars),
    primary_content_pre_truncation_length: text.length,
    primary_content_truncated: text.length > regionPolicy.page_owned_text_max_chars,
    authored_content: authoredContent(scope),
    entity_proposition: entityProposition(scope, proposition),
    primary_heading_outline: headingOutline(scope),
    primary_table_headers: tableHeaders(scope),
    question_answer_relationships: questionAnswerRelationships(scope),
  };
}

/** Unique, whitespace-collapsed, case-insensitively deduplicated values. */
function appendUnique(values: string[], seen: Set<string>, value: string, max: number) {
  const cleaned = squash(value).slice(0, max);
  const key = cleaned.toLowerCase();
  if (cleaned && !seen.has(key)) {
    seen.add(key);
    values.push(cleaned);
  }
}

function ctaValue(node: HtmlElement) {
  if (node.tagName === 'button') return textContent(node);
  if (node.tagName === 'input')
    return ['submit', 'button'].includes(attribute(node, 'type').trim().toLowerCase())
      ? attribute(node, 'value')
      : '';
  return node.tagName === 'a' && isCtaAnchor(node) ? textContent(node) : '';
}

export function ctaTexts(root: HtmlNode) {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const node of elements(root)) {
    if (texts.length >= limits.cta_texts) break;
    if (['button', 'a', 'input'].includes(node.tagName))
      appendUnique(texts, seen, ctaValue(node), limits.cta_text_chars);
  }
  return texts;
}

const IGNORED_FIELD_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
export function formFields(root: HtmlNode) {
  const labels = new Map<string, string>();
  for (const label of elements(root, 'label')) {
    const target = attribute(label, 'for').trim();
    if (target && regionNodeIsVisible(label) && !labels.has(target))
      labels.set(target, textContent(label));
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const node of elements(root)) {
    if (fields.length >= limits.form_fields) break;
    if (!['input', 'select', 'textarea'].includes(node.tagName) || !regionNodeIsVisible(node))
      continue;
    if (IGNORED_FIELD_TYPES.has(attribute(node, 'type').trim().toLowerCase())) continue;
    const candidate =
      labels.get(attribute(node, 'id').trim()) ||
      attribute(node, 'aria-label') ||
      attribute(node, 'placeholder') ||
      attribute(node, 'name');
    appendUnique(fields, seen, candidate, limits.form_field_chars);
  }
  return fields;
}

/** The longest visible primary-content ordered list outside repeated card grids. */
export function orderedListSteps(page: PageScope) {
  let longest = 0;
  for (const list of elements(page.region, 'ol')) {
    if (!regionNodeIsVisible(list) || [...ancestors(list)].some((node) => page.cards.has(node)))
      continue;
    longest = Math.max(longest, childElements(list).filter((item) => item.tagName === 'li').length);
  }
  return longest;
}
