/** Generic catalog structure: breadcrumbs, product and category cards, the page's own price. */
import {
  attribute,
  elements,
  parentElement,
  textContent,
  type HtmlElement,
} from '../../web-evidence/html.ts';
import { policy } from '../../config.ts';
import { squash } from './policy.ts';
import { regionText, type PageScope } from './regions.ts';

const MAX_BREADCRUMBS = policy.site_health.architecture.max_breadcrumb_items;
const PRICE = /(?:[$£€₹]|AUD|USD|CAD|NZD|GBP|EUR|INR)\s*\d[\d,.]*(?:\.\d{1,2})?/iu;
const AVAILABILITY =
  /\b(?:in stock|out of stock|sold out|pre-?order|backorder(?:ed)?|(?:un)?available for (?:order|purchase|pickup))\b/iu;
const PRICE_CONTEXT_CHARS = 48;
const PRODUCT_TOKENS = ['product-card', 'product_card', 'productgrid', 'product-tile'];
const CATEGORY_TOKENS = ['subcategory', 'category-card', 'department', 'collection-card'];
const PRODUCT_SEGMENTS = new Set(['product', 'products']);

type Link = { url: string; title: string };
export function emptyCommerceFacts() {
  return {
    breadcrumbs: [] as string[],
    breadcrumb_links: [] as Link[],
    product_cards: [] as Link[],
    category_links: [] as Link[],
    category_role: 'unknown',
    visible_price: '',
    visible_availability: '',
  };
}

const resolve = (href: string, base: string) => {
  try {
    return new URL(href, base).href.slice(0, 2048);
  } catch {
    return '';
  }
};
const appendUnique = (rows: Link[], row: Link, limit: number) => {
  if (rows.length < limit && !rows.some((item) => item.url === row.url && item.title === row.title))
    rows.push(row);
};
function ancestorTokens(node: HtmlElement) {
  const values: string[] = [];
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < 4 && current; depth++) {
    values.push(
      ...['class', 'id', 'role', 'data-testid'].map((name) =>
        attribute(current!, name).toLowerCase(),
      ),
    );
    current = parentElement(current);
  }
  return values.join(' ');
}
function isProductPath(href: string) {
  const path = href.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu, '').split(/[?#]/u)[0] ?? '';
  return path.split('/').some((segment) => PRODUCT_SEGMENTS.has(segment.trim().toLowerCase()));
}
const isBreadcrumb = (node: HtmlElement) =>
  attribute(node, 'class').toLowerCase().includes('breadcrumb') ||
  ['breadcrumb', 'Breadcrumb'].includes(attribute(node, 'aria-label'));

function breadcrumbs(page: PageScope, finalUrl: string) {
  const values: string[] = [];
  const links: Link[] = [];
  for (const trail of [...elements(page.root)].filter(isBreadcrumb).slice(0, 4)) {
    const items = [...elements(trail)]
      .filter((item) => item !== trail && ['a', 'li', 'span'].includes(item.tagName))
      .slice(0, MAX_BREADCRUMBS * 4);
    for (const item of items) {
      const text = textContent(item).slice(0, 255);
      if (text && !values.includes(text) && values.length < MAX_BREADCRUMBS) values.push(text);
      const href = attribute(item, 'href').trim();
      if (href) appendUnique(links, { url: resolve(href, finalUrl), title: text }, MAX_BREADCRUMBS);
      if (values.length >= MAX_BREADCRUMBS && links.length >= MAX_BREADCRUMBS)
        return { values, links };
    }
  }
  return { values, links };
}

function cards(page: PageScope, finalUrl: string) {
  const products: Link[] = [];
  const categories: Link[] = [];
  for (const anchor of elements(page.region, 'a')) {
    const href = attribute(anchor, 'href').trim();
    const label = textContent(anchor);
    if (!href || !label) continue;
    const row = { url: resolve(href, finalUrl), title: label.slice(0, 512) };
    const tokens = ancestorTokens(anchor);
    if (PRODUCT_TOKENS.some((token) => tokens.includes(token)) || isProductPath(href))
      appendUnique(products, row, 200);
    else if (CATEGORY_TOKENS.some((token) => tokens.includes(token)))
      appendUnique(categories, row, 100);
  }
  return { products, categories };
}

/**
 * Structural taxonomy and card facts without assigning a page kind. The price
 * is read from the page's own visible text outside card lists, with the words
 * around it so a "free shipping over $100" banner is not taken as a price.
 */
export function commerceFacts(page: PageScope, finalUrl: string) {
  const trail = breadcrumbs(page, finalUrl);
  const { products, categories } = cards(page, finalUrl);
  const text = regionText(page.region, page.cards);
  const price = PRICE.exec(text);
  const start = price ? Math.max(0, price.index - PRICE_CONTEXT_CHARS) : 0;
  let role = 'unknown';
  if (products.length) role = 'leaf';
  else if (categories.length) role = 'hub';
  return {
    breadcrumbs: trail.values,
    breadcrumb_links: trail.links,
    product_cards: products,
    category_links: categories,
    category_role: role,
    visible_price: price?.[0].slice(0, 64) ?? '',
    visible_availability: AVAILABILITY.exec(text)?.[0].slice(0, 64) ?? '',
    visible_price_context: price
      ? squash(text.slice(start, price.index + price[0].length + PRICE_CONTEXT_CHARS))
      : '',
  };
}
