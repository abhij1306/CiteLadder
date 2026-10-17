/**
 * Deterministic page facts for one fetched page: metadata, headings, links,
 * structured data, page-owned content, and delivery/security signals. The
 * result is the bounded JSON persisted as `site_fetch_artifacts.normalized_facts`
 * and read by every Site Health analyzer. A malformed page yields partial facts.
 */
import { policy, resolveSettingSpec } from '../../config.ts';
import { compareText } from '../../text-order.ts';
import { onlyOf } from '../../lists.ts';
import {
  ancestors,
  attribute,
  document,
  elements,
  hasAttribute,
  parentElement,
  textContent,
  textNodes,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { accessibilityFacts } from './accessibility-facts.ts';
import { authorshipFacts } from './authorship-facts.ts';
import { commerceFacts, emptyCommerceFacts } from './commerce-facts.ts';
import {
  contentFacts,
  ctaTexts,
  emptyContentFacts,
  formFields,
  orderedListSteps,
} from './content-facts.ts';
import { emptyEntityFacts, entityFacts } from './entity-facts.ts';
import { analysisPolicy, limits, squash } from './policy.ts';
import { mergeRobotsHeader, robotsMeta } from './robots-directives.ts';
import { elementRegion, nodeIsRendered, pageScope, regionNodeIsVisible } from './regions.ts';
import { emptySourceSupport, sameSite, sourceSupportFacts } from './source-support.ts';
import {
  declaredSchemaTypes,
  jsonLdBlocks,
  jsonLdObjects,
  microdataBlocks,
  productFacts,
} from './structured-data.ts';

const f = analysisPolicy.facts;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const JAVASCRIPT_TYPES = new Set(f.inline_script_javascript_types);
const NON_NAVIGABLE = f.non_navigable_href_prefixes;
const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
];
const PRUNED_BODY_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const FRESHNESS_SEGMENTS = new Set(f.freshness.route_segments);
const FRESHNESS_IDENTITY = new RegExp(f.freshness.identity_pattern, 'i');
const FRESHNESS_PURPOSE = new RegExp(f.freshness.purpose_pattern, 'i');

export type Delivery = {
  finalUrl: string;
  contentType?: string;
  charset?: string;
  statusCode?: number | null;
  headers?: Record<string, string>;
  httpVersion?: string;
  ttfbMs?: number | null;
  latencyMs?: number | null;
  wireBytes?: number | null;
  decodedBytes?: number | null;
};

export function factSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  return {
    maxHtmlBytes: number('max_html_bytes'),
    maxLinks: number('max_links_per_page'),
    maxBlocks: number('max_structured_data_blocks'),
    maxTextChars: number('max_text_chars'),
  };
}

const metaContent = (root: HtmlNode, name: string) =>
  [...elements(root, 'meta')]
    .filter((meta) => attribute(meta, 'name').toLowerCase() === name)
    .map((meta) => attribute(meta, 'content').trim())
    .find(Boolean)
    ?.slice(0, limits.meta_chars) ?? '';

/** Update-date meta keys, in the order they are trusted. */
const MODIFIED_META_KEYS = [
  'article:modified_time',
  'og:updated_time',
  'last-modified',
  'dcterms.modified',
  'dc.date.modified',
];

/** `<meta property|name="prefix:…">` values; the first declaration of a key wins. */
function metaPropertyMap(root: HtmlNode, prefix: string) {
  const found: Record<string, string> = {};
  for (const meta of elements(root, 'meta')) {
    const key = (attribute(meta, 'property') || attribute(meta, 'name')).trim().toLowerCase();
    const content = attribute(meta, 'content').trim();
    if (key.startsWith(prefix) && content && !(key in found))
      found[key] = content.slice(0, limits.meta_chars);
  }
  return found;
}

function canonicalDeclarations(root: HtmlNode) {
  const declarations: string[] = [];
  for (const link of elements(root, 'link')) {
    if (attribute(link, 'rel').toLowerCase() !== 'canonical') continue;
    const href = attribute(link, 'href').trim().slice(0, limits.url_chars);
    if (href && !declarations.includes(href)) declarations.push(href);
  }
  return declarations;
}

/** The channel and authored value a `mailto:`/`tel:` href declares, or null. */
function contactHref(href: string) {
  const lowered = href.toLowerCase();
  let channel = '';
  if (lowered.startsWith('mailto:')) channel = 'email';
  else if (lowered.startsWith('tel:')) channel = 'phone';
  if (!channel) return null;
  const raw = href.slice(channel === 'email' ? 7 : 4).split('?')[0]!;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed escape keeps the authored value.
  }
  return { channel, value: decoded.trim().slice(0, limits.contact_value_chars) };
}

/** Declared contact points from `mailto:`/`tel:` hrefs; body-text matches are not declarations. */
function contactPoints(root: HtmlNode) {
  const points: { channel: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const anchor of elements(root, 'a')) {
    if (points.length >= limits.contact_points) break;
    if (!regionNodeIsVisible(anchor)) continue;
    const declared = contactHref(attribute(anchor, 'href').trim());
    if (!declared) continue;
    const { channel, value } = declared;
    const key = `${channel}|${value.toLowerCase()}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    points.push({ channel, value });
  }
  return points;
}

/** The host a link names, or null when it is relative or has no authority. */
function hrefHost(href: string) {
  const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/iu.exec(href)?.[1];
  if (!authority) return null;
  const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/u, '');
  return host.replaceAll(/[[\]]/gu, '').toLowerCase() || null;
}
/**
 * Internal means the crawl's own site: the page's registrable domain and every
 * subdomain of it, the same scope the crawler admits. An exact-host test hid
 * `www`/`docs` links from the link graph and broken-link checks the crawl fetched.
 */
const isInternal = (href: string, baseHost: string) => {
  const host = hrefHost(href);
  return host === null || (Boolean(baseHost) && sameSite(host, baseHost.toLowerCase()));
};

function linksAndAssets(root: HtmlNode, baseHost: string, maxLinks: number) {
  const anchors = [];
  for (const anchor of elements(root, 'a')) {
    if (anchors.length >= maxLinks) break;
    if (!nodeIsRendered(anchor)) continue;
    const href = attribute(anchor, 'href').trim();
    if (!href || NON_NAVIGABLE.some((prefix) => href.toLowerCase().startsWith(prefix))) continue;
    anchors.push({
      kind: 'anchor',
      url: href.slice(0, limits.url_chars),
      is_internal: isInternal(href, baseHost),
      rel: attribute(anchor, 'rel').slice(0, 128),
      anchor_text: textContent(anchor).slice(0, limits.anchor_text_chars),
      region: elementRegion(anchor),
    });
  }
  const assets = (
    tag: string,
    name: string,
    kind: string,
    include = (_node: HtmlElement) => true,
  ) =>
    [...elements(root, tag)]
      .filter((node) => include(node) && attribute(node, name).trim())
      .slice(0, maxLinks)
      .map((node) => {
        const url = attribute(node, name).trim();
        return {
          kind,
          url: url.slice(0, limits.url_chars),
          is_internal: isInternal(url, baseHost),
        };
      });
  return {
    anchors,
    images: assets('img', 'src', 'image'),
    scripts: assets('script', 'src', 'script'),
    stylesheets: assets('link', 'href', 'stylesheet', (node) =>
      attribute(node, 'rel').trim().toLowerCase().split(/\s+/u).includes('stylesheet'),
    ),
    anchors_truncated: anchors.length >= maxLinks,
  };
}

/** Internal anchor text: how a hub advertises the pages it links to. */
function linkContext(anchors: { is_internal: boolean; anchor_text: string }[]) {
  const context: string[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (context.length >= limits.link_context) break;
    const cleaned = squash(anchor.anchor_text).slice(0, limits.link_context_chars);
    if (!anchor.is_internal || !cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    context.push(cleaned);
  }
  return context;
}

function headingFacts(root: HtmlNode) {
  const rendered = (node: HtmlElement) =>
    [node, ...ancestors(node)].every(
      (item) =>
        item.tagName !== 'template' &&
        !hasAttribute(item, 'hidden') &&
        !hasAttribute(item, 'inert') &&
        attribute(item, 'aria-hidden').trim().toLowerCase() !== 'true',
    );
  const byLevel = new Map<string, HtmlElement[]>();
  for (const node of elements(root))
    if (/^h[1-6]$/u.test(node.tagName) && rendered(node))
      byLevel.set(node.tagName, [...(byLevel.get(node.tagName) ?? []), node]);
  const counts = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [`h${level}`, byLevel.get(`h${level}`)?.length ?? 0]),
  );
  const texts = (tag: string) =>
    (byLevel.get(tag) ?? [])
      .slice(0, limits.headings_kept)
      .map((node) => textContent(node).slice(0, limits.heading_chars));
  return {
    counts,
    h1_count: counts.h1 ?? 0,
    h1_texts: texts('h1'),
    h2_texts: texts('h2'),
    h3_texts: texts('h3'),
  };
}

/** Context that makes a page's currency matter, without reading a date. */
function freshnessContext(
  finalUrl: string,
  title: string,
  headings: ReturnType<typeof headingFacts>,
) {
  const reasons: string[] = [];
  let path = '';
  try {
    path = new URL(finalUrl).pathname;
  } catch {
    path = '';
  }
  if (path.split('/').some((segment) => FRESHNESS_SEGMENTS.has(segment.toLowerCase())))
    reasons.push('changelog_or_news_route');
  const identity = [title, ...headings.h1_texts, ...headings.h2_texts].join(' ');
  if (FRESHNESS_IDENTITY.test(identity)) reasons.push('explicit_year_or_version_identity');
  if (FRESHNESS_PURPOSE.test(identity)) reasons.push('time_bound_purpose_identity');
  return { required: reasons.length > 0, reasons };
}

function images(root: HtmlNode) {
  const nodes = [...elements(root, 'img')];
  return {
    count: nodes.length,
    missing_alt: nodes.filter((node) => !hasAttribute(node, 'alt')).length,
    decorative_alt: nodes.filter(
      (node) => hasAttribute(node, 'alt') && !attribute(node, 'alt').trim(),
    ).length,
  };
}

function hreflangAlternates(root: HtmlNode, finalUrl: string) {
  const alternates: { hreflang: string; url: string }[] = [];
  for (const link of elements(root, 'link')) {
    if (alternates.length >= limits.hreflang_alternates) break;
    const hreflang = attribute(link, 'hreflang').trim();
    const href = attribute(link, 'href').trim();
    if (
      !attribute(link, 'rel').toLowerCase().split(/\s+/u).includes('alternate') ||
      !hreflang ||
      !href
    )
      continue;
    let url: string;
    try {
      url = new URL(href, finalUrl).href;
    } catch {
      continue;
    }
    alternates.push({
      hreflang: hreflang.slice(0, limits.hreflang_chars),
      url: url.slice(0, limits.url_chars),
    });
  }
  return alternates;
}

/** Characters of inline JavaScript; JSON-LD and other data blocks are not code. */
function inlineScriptChars(root: HtmlNode) {
  let total = 0;
  for (const script of elements(root, 'script')) {
    const type = attribute(script, 'type').trim().toLowerCase();
    if (attribute(script, 'src').trim() || (type && !JAVASCRIPT_TYPES.has(type))) continue;
    total += textContent(script).length;
    if (total >= limits.inline_script_chars) return limits.inline_script_chars;
  }
  return total;
}

/** A top-level navigation: assigning `location`/`location.href`, or `location.replace/assign(`. */
const SCRIPT_NAVIGATION = /\blocation(?:\.href)?\s*=(?!=)|\blocation\.(?:replace|assign)\s*\(/u;

/**
 * `delay; url=target` as browsers read it: a delay, then an optional target
 * (with or without `url=` and quotes). A bare delay only reloads the page.
 */
function refreshTarget(content: string) {
  const separator = content.search(/[;,]/u);
  const seconds = Number.parseFloat(separator === -1 ? content : content.slice(0, separator));
  if (separator === -1 || !Number.isFinite(seconds)) return null;
  let target = content.slice(separator + 1).trim();
  if (/^url\s*=/iu.test(target)) target = target.slice(target.indexOf('=') + 1).trim();
  target = target.replaceAll(/^["']|["']$/gu, '').trim();
  return target ? { seconds, target } : null;
}

/**
 * A meta refresh that sends the reader to another URL, and whether inline
 * script navigates the window. A refresh to the page itself is a reload.
 */
function clientRedirect(root: HtmlNode, finalUrl: string) {
  const refresh = metaRefresh(root, finalUrl);
  return {
    meta_refresh_url: refresh?.url ?? '',
    meta_refresh_seconds: refresh?.seconds ?? null,
    script_navigates: scriptNavigates(root),
  };
}

/** The first meta refresh that leads to another URL, resolved against the page. */
function metaRefresh(root: HtmlNode, finalUrl: string) {
  for (const meta of elements(root, 'meta')) {
    if (attribute(meta, 'http-equiv').trim().toLowerCase() !== 'refresh') continue;
    const refresh = refreshTarget(attribute(meta, 'content'));
    if (!refresh) continue;
    try {
      const target = new URL(refresh.target, finalUrl);
      if (target.href !== new URL(finalUrl).href)
        return { url: target.href.slice(0, limits.url_chars), seconds: refresh.seconds };
    } catch {
      // An unresolvable target sends the reader nowhere.
    }
  }
  return null;
}

/** Whether inline JavaScript, within the scan budget, navigates the window. */
function scriptNavigates(root: HtmlNode) {
  let scanned = 0;
  for (const script of elements(root, 'script')) {
    const type = attribute(script, 'type').trim().toLowerCase();
    if (attribute(script, 'src').trim() || (type && !JAVASCRIPT_TYPES.has(type))) continue;
    const code = textContent(script).slice(0, limits.inline_script_chars - scanned);
    scanned += code.length;
    if (SCRIPT_NAVIGATION.test(code)) return true;
    if (scanned >= limits.inline_script_chars) return false;
  }
  return false;
}

function blockingResources(root: HtmlNode, stylesheets: number) {
  const scripts = [...elements(root, 'script')].filter(
    (node) =>
      attribute(node, 'src').trim() && !hasAttribute(node, 'async') && !hasAttribute(node, 'defer'),
  ).length;
  return { scripts, stylesheets, total: scripts + stylesheets };
}

/** Visible body text (non-rendered subtrees pruned) and its word count. */
function bodyText(root: HtmlNode, maxChars: number) {
  const body: HtmlNode = elements(root, 'body').next().value ?? root;
  let raw = '';
  for (const node of textNodes(body)) {
    let pruned = false;
    for (
      let current = parentElement(node);
      current && current !== body;
      current = parentElement(current)
    )
      if (PRUNED_BODY_TAGS.has(current.tagName)) pruned = true;
    if (!pruned) raw += node.value;
  }
  const full = squash(raw);
  const text = full.slice(0, maxChars);
  return { text, word_count: text ? text.split(' ').length : 0, truncated: full.length > maxChars };
}

function emptyAuthorship() {
  return {
    visible_byline: '',
    visible_profile_url: '',
    visible_date: '',
    declared_author: '',
    declared_author_source: '',
  };
}

function emptyFacts() {
  return {
    extraction: { state: 'unavailable', reason: 'document_not_observed', truncated: false },
    has_html: false,
    title: '',
    meta_description: '',
    robots: robotsMeta(document(Buffer.alloc(0))),
    canonical_url: '',
    canonical_declarations: [] as string[],
    open_graph: {} as Record<string, string>,
    twitter: {} as Record<string, string>,
    headings: headingFacts(document(Buffer.alloc(0))),
    freshness_context: { required: false, reasons: [] as string[] },
    images: { count: 0, missing_alt: 0, decorative_alt: 0 },
    accessibility: accessibilityFacts(document(Buffer.alloc(0)), 0),
    mobile: { viewport: { declared: false, content: '' } },
    body: { text: '', word_count: 0, truncated: false },
    cta_text: [] as string[],
    form_fields: [] as string[],
    link_context: [] as string[],
    entity: emptyEntityFacts(),
    structured_data: structuredData(document(Buffer.alloc(0)), 0),
    links: linksAndAssets(document(Buffer.alloc(0)), '', 0),
    blocking_resources: { scripts: 0, stylesheets: 0, total: 0 },
    author: '',
    dates: { published: '', modified: '' },
    authorship: emptyAuthorship(),
    landmarks: { main: false, article: false, nav: false } as Record<string, boolean>,
    ordered_list_steps: 0,
    hreflang_alternates: [] as { hreflang: string; url: string }[],
    ...emptyContentFacts(),
    source_support: emptySourceSupport(),
    inline_script_chars: 0,
    client_redirect: {
      meta_refresh_url: '',
      meta_refresh_seconds: null as number | null,
      script_navigates: false,
    },
    contact_points: [] as { channel: string; value: string }[],
    commerce: emptyCommerceFacts() as ReturnType<typeof emptyCommerceFacts> & {
      visible_price_context?: string;
    },
  };
}
type DocumentFacts = ReturnType<typeof emptyFacts>;
export type PageFacts = DocumentFacts & {
  extractor_version: string;
  content_type: string;
  delivery: ReturnType<typeof deliveryFacts>;
};

/** Page-owned facts are cleared when the document is not one the analyzer can read. */
function clearPageOwned<T extends DocumentFacts>(facts: T, reason: string): T {
  return {
    ...facts,
    ...emptyContentFacts(),
    entity: emptyEntityFacts(),
    source_support: emptySourceSupport(),
    author: '',
    dates: { published: '', modified: '' },
    authorship: emptyAuthorship(),
    contact_points: [],
    commerce: emptyCommerceFacts(),
    extraction: { state: 'unavailable', reason, truncated: facts.extraction.truncated },
  };
}

function structuredData(root: HtmlNode, maxBlocks: number) {
  const raw = [...elements(root, 'script')]
    .filter((node) => attribute(node, 'type').toLowerCase() === 'application/ld+json')
    .map(textContent);
  const objects = jsonLdObjects(raw);
  const jsonLd = jsonLdBlocks(objects, maxBlocks);
  const microdata = microdataBlocks(root, maxBlocks);
  const blocks = [...jsonLd, ...microdata].slice(0, maxBlocks);
  return {
    blocks,
    count: blocks.length,
    has_json_ld: jsonLd.length > 0,
    has_microdata: microdata.length > 0,
    types: [...new Set(blocks.map((block) => block.type))].sort(compareText),
    declared_types: declaredSchemaTypes(objects, root, maxBlocks),
    product: productFacts(blocks),
  };
}

function extractDocument(
  root: HtmlNode,
  finalUrl: string,
  settings: ReturnType<typeof factSettings>,
): DocumentFacts {
  const page = pageScope(root, finalUrl);
  let baseHost = '';
  try {
    baseHost = new URL(finalUrl).hostname;
  } catch {
    baseHost = '';
  }
  const title = elements(root, 'title').next().value;
  const headings = headingFacts(root);
  const declarations = canonicalDeclarations(root);
  const sd = structuredData(root, settings.maxBlocks);
  const links = linksAndAssets(root, baseHost, settings.maxLinks);
  const viewport = metaContent(root, 'viewport');
  const articleMeta = metaPropertyMap(root, 'article:');
  const allMeta = metaPropertyMap(root, '');
  const modifiedMeta = MODIFIED_META_KEYS.map((key) => allMeta[key]).find(Boolean) ?? '';
  const facts: DocumentFacts = {
    ...emptyFacts(),
    has_html: true,
    extraction: { state: 'available', reason: '', truncated: false },
    title: title ? textContent(title).slice(0, limits.title_chars) : '',
    meta_description: metaContent(root, 'description'),
    robots: robotsMeta(root),
    canonical_declarations: declarations,
    canonical_url: onlyOf(declarations) ?? '',
    open_graph: metaPropertyMap(root, 'og:'),
    twitter: metaPropertyMap(root, 'twitter:'),
    headings,
    freshness_context: freshnessContext(finalUrl, title ? textContent(title) : '', headings),
    images: images(root),
    accessibility: accessibilityFacts(root, limits.headings_kept),
    mobile: { viewport: { declared: Boolean(viewport), content: viewport } },
    structured_data: sd,
    entity: entityFacts(page),
    links,
    cta_text: ctaTexts(root),
    form_fields: formFields(root),
    link_context: linkContext(links.anchors),
    contact_points: contactPoints(root),
    landmarks: Object.fromEntries(
      ['main', 'article', 'nav'].map((tag) => [tag, !elements(root, tag).next().done]),
    ),
    ordered_list_steps: orderedListSteps(page),
    hreflang_alternates: hreflangAlternates(root, finalUrl),
    ...contentFacts(page),
    source_support: sourceSupportFacts(page, finalUrl),
    inline_script_chars: inlineScriptChars(root),
    client_redirect: clientRedirect(root, finalUrl),
    blocking_resources: blockingResources(root, links.stylesheets.length),
    body: bodyText(root, settings.maxTextChars),
    ...authorshipFacts(page, sd.blocks, articleMeta, metaContent(root, 'author'), modifiedMeta),
    commerce: commerceFacts(page, finalUrl),
  };
  const shell =
    facts.body.word_count < f.server_rendered_min_words &&
    facts.inline_script_chars > facts.body.text.length;
  return shell ? clearPageOwned(facts, 'client_rendering_required') : facts;
}

function deliveryFacts(delivery: Delivery, headers: Record<string, string>) {
  let scheme = '';
  try {
    scheme = new URL(delivery.finalUrl).protocol.slice(0, -1).toLowerCase();
  } catch {
    scheme = '';
  }
  const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
  return {
    final_url: delivery.finalUrl.slice(0, limits.url_chars),
    scheme,
    is_https: scheme === 'https',
    status_code: delivery.statusCode ?? null,
    http_version: delivery.httpVersion ?? '',
    ttfb_ms: delivery.ttfbMs ?? null,
    latency_ms: delivery.latencyMs ?? null,
    wire_bytes: delivery.wireBytes ?? null,
    decoded_bytes: delivery.decodedBytes ?? null,
    content_encoding: encoding,
    is_compressed: Boolean(encoding) && encoding !== 'identity',
    cache_control: headers['cache-control'] ?? '',
    security_headers: Object.fromEntries(SECURITY_HEADERS.map((name) => [name, name in headers])),
  };
}

/**
 * Bounded, deterministic facts for one page; never throws on hostile markup.
 * `parsed` is the whole body's tree when the caller (discovery) already has
 * it; an oversized body is still re-parsed under the fact byte cap.
 */
export function extractPageFacts(
  body: Buffer,
  delivery: Delivery,
  settings = factSettings(),
  parsed?: HtmlNode,
): PageFacts {
  let facts = emptyFacts();
  if (!body.length) facts.extraction.reason = 'empty_response_body';
  else {
    const root =
      parsed && body.length <= settings.maxHtmlBytes
        ? parsed
        : document(body.subarray(0, settings.maxHtmlBytes), delivery.charset);
    facts = extractDocument(root, delivery.finalUrl, settings);
    facts.extraction.truncated = body.length > settings.maxHtmlBytes;
  }
  const headers = Object.fromEntries(
    Object.entries(delivery.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      String(value),
    ]),
  );
  const contentType = (delivery.contentType ?? '').trim().toLowerCase();
  const mediaType = contentType.split(';')[0]!.trim();
  if (facts.has_html && mediaType && !HTML_TYPES.has(mediaType))
    facts = clearPageOwned(facts, 'unsupported_content_type');
  return {
    ...facts,
    extractor_version: policy.site_health.versions.extractor,
    content_type: contentType,
    delivery: deliveryFacts(delivery, headers),
    robots: mergeRobotsHeader(facts.robots, headers['x-robots-tag'] ?? ''),
  };
}
