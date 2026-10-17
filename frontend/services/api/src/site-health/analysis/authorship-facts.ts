/** Author and publication dates: declared values first, then bounded visible evidence. */
import {
  ancestors,
  attribute,
  elements,
  hasAttribute,
  textNodes,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { stripTrailing } from '../../text-order.ts';
import { analysisPolicy, limits, regionPolicy, squash } from './policy.ts';
import { outsideContainers, regionNodeIsVisible, type PageScope } from './regions.ts';
import type { SchemaBlock } from './structured-data.ts';

const a = analysisPolicy.facts.authorship;
const BYLINE = new RegExp(a.byline_pattern);
const AUTHOR_NAME = new RegExp(a.visible_author_name_pattern);
const DATE = new RegExp(a.date_pattern, 'i');
const PUBLISHER = new RegExp(a.visible_publisher_pattern);
const ATTRIBUTION_PREFIX = new RegExp(a.profile_link_attribution_prefix_pattern);
const AUTHOR_TOKENS = new Set(a.visible_author_node_tokens);
const DATE_TOKENS = new Set(a.visible_date_node_tokens);
const HEADING_EXCLUSIONS = new Set(a.visible_author_heading_exclusions);

/** The first "By <Name>" byline; `leading` requires it to open the text. */
function visibleByline(text: string, leading = false) {
  const match = BYLINE.exec(text);
  if (!match || (leading && text.slice(0, match.index).trim())) return '';
  return match[0].trim();
}
const visibleDate = (text: string) => DATE.exec(text)?.[0].trim() ?? '';
function visibleAuthorName(text: string) {
  const candidate = squash(text);
  return AUTHOR_NAME.test(candidate) ? candidate : '';
}

/** Descendant text with a boundary between inline parts such as `<br>`. */
const spacedText = (node: HtmlNode) =>
  squash([...textNodes(node)].map((part) => part.value).join(' '));
const attributeTokens = (node: HtmlElement) =>
  new Set(
    ['class', 'id', 'itemprop', 'rel']
      .map((name) => attribute(node, name))
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter(Boolean),
  );
const withoutAttribution = (value: string) =>
  value.replace(ATTRIBUTION_PREFIX, '').replace(/^the\s+/iu, '');

function profileUrl(node: HtmlElement, author: string) {
  const links =
    node.tagName === 'a'
      ? [node]
      : [
          ...[...ancestors(node)]
            .filter((item) => item.tagName === 'a' && hasAttribute(item, 'href'))
            .slice(0, 1),
          ...[...elements(node, 'a')].filter((item) => item !== node && hasAttribute(item, 'href')),
        ];
  const expected = withoutAttribution(squash(author.toLowerCase()));
  const link = links.find((item) => {
    const named = withoutAttribution(squash(spacedText(item).toLowerCase()));
    return attribute(item, 'href') && named && named === expected;
  });
  return (link ? attribute(link, 'href').trim() : '').slice(0, limits.url_chars);
}

const hasAuthorToken = (tokens: Set<string>) =>
  [...tokens].some((token) => AUTHOR_TOKENS.has(token));

/** A bare Title-Case heading names an author only inside an author or byline container. */
const insideAuthorContainer = (node: HtmlElement) =>
  [...ancestors(node)].some((item) => hasAuthorToken(attributeTokens(item)));

function authorCandidate(node: HtmlElement, text: string, authorTokens: boolean) {
  const byline = visibleByline(text);
  if (byline) return byline;
  if (authorTokens) return visibleAuthorName(text);
  if (
    ['h2', 'h3'].includes(node.tagName) &&
    !HEADING_EXCLUSIONS.has(text.toLowerCase()) &&
    insideAuthorContainer(node)
  )
    return visibleAuthorName(text);
  return '';
}

function observedAuthor(node: HtmlElement, text: string, tokens: Set<string>) {
  let author = '';
  if (['p', 'small', 'span'].includes(node.tagName))
    author =
      stripTrailing((PUBLISHER.exec(text)?.[1] ?? '').trim(), '.,;:') || visibleByline(text, true);
  const authorTokens = hasAuthorToken(tokens);
  if (!author && (authorTokens || ['h1', 'h2', 'h3'].includes(node.tagName)))
    author = authorCandidate(node, text, authorTokens);
  return author;
}

/** Targeted visible byline and date evidence from the primary region, outside card lists. */
function visibleValues(page: PageScope) {
  const found = { author: '', profile: '', published: '' };
  let scanned = 0;
  for (const node of elements(page.region)) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    if (!regionNodeIsVisible(node) || !outsideContainers(node, page.cards)) continue;
    const tokens = attributeTokens(node);
    const text = spacedText(node);
    const author = observedAuthor(node, text, tokens);
    if (!found.author && author) {
      found.author = author;
      found.profile = profileUrl(node, author);
    }
    if (
      !found.published &&
      (node.tagName === 'time' || [...tokens].some((t) => DATE_TOKENS.has(t)))
    )
      found.published = visibleDate(text);
    if (found.author && found.published) break;
  }
  return found;
}

/** The page's own first `<time datetime>`: a post card's or footer's date is not the page's. */
const firstDeclaredTime = (page: PageScope) =>
  [...elements(page.region, 'time')]
    .filter((node) => regionNodeIsVisible(node) && outsideContainers(node, page.cards))
    .map((node) => attribute(node, 'datetime').trim())
    .find(Boolean) ?? '';

function declaredAuthor(structured: string, meta: string, article: string): [string, string] {
  for (const [value, source] of [
    [structured, 'structured_data'],
    [meta, 'meta_author'],
    [article, 'article_meta'],
  ] as const)
    if (value.trim()) return [value.trim(), source];
  return ['', ''];
}

export function authorshipFacts(
  page: PageScope,
  blocks: SchemaBlock[],
  articleMeta: Record<string, string>,
  metaAuthor: string,
  metaModified: string,
) {
  const structured = { author: '', published: '', modified: '' };
  for (const block of blocks) {
    structured.author ||= block.author.trim();
    structured.published ||= block.date_published.trim();
    structured.modified ||= block.date_modified.trim();
  }
  const visible = visibleValues(page);
  const [declared, source] = declaredAuthor(
    structured.author,
    metaAuthor,
    articleMeta['article:author'] ?? '',
  );
  const published =
    structured.published ||
    (articleMeta['article:published_time'] ?? '').trim() ||
    firstDeclaredTime(page) ||
    visible.published;
  const modified = structured.modified || metaModified.trim();
  return {
    author: (declared || visible.author).slice(0, limits.author_chars),
    dates: {
      published: published.slice(0, limits.date_chars),
      modified: modified.slice(0, limits.date_chars),
    },
    authorship: {
      visible_byline: visible.author.slice(0, limits.author_chars),
      visible_profile_url: visible.profile,
      visible_date: visible.published.slice(0, limits.date_chars),
      declared_author: declared.slice(0, limits.author_chars),
      declared_author_source: source,
    },
  };
}
