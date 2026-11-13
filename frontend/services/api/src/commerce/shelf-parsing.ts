import { z } from 'zod';
import { auditPolicy } from '../audits/config.ts';
import { casefold } from '../casefold.ts';
import { canonicalPage } from '../page-identity.ts';
import { AMOUNT_CHARACTERS, localizedPrice } from './projection-facts.ts';
import { onlyOf } from '../lists.ts';
import { domainMatches } from '../analysis/domains.ts';
import { stripTrailing } from '../text-order.ts';
import { failureFacts, getLogger } from '../logging.ts';

export const shelfPolicy = auditPolicy.commerce_shelf;
export const boundedText = (text: string, limit: number) => [...text].slice(0, limit).join('');
type RecommendationSpan = {
  text: string;
  rank: number | null;
  orderObservable: boolean;
  /** A list item, as opposed to a prose sentence. */
  listed: boolean;
};
function recommendationSpans(answer: string): RecommendationSpan[] {
  const spans: RecommendationSpan[] = [];
  for (const line of answer.split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/u)) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const [, rank, ordered] = /^(\d{1,2})[.)]\s+(\S.*)$/u.exec(cleaned) ?? [];
    const [, bullet] = /^[-*•]\s+(\S.*)$/u.exec(cleaned) ?? [];
    const last = spans.at(-1);
    if (ordered !== undefined)
      spans.push({ text: ordered.trim(), rank: Number(rank), orderObservable: true, listed: true });
    else if (bullet !== undefined)
      spans.push({ text: bullet.trim(), rank: null, orderObservable: false, listed: true });
    else if (last) last.text += ` ${cleaned}`;
  }
  if (spans.length) return spans.slice(0, shelfPolicy.span_limit);
  const prose = answer
    .trim()
    .split(/(?<=[.!?])\s+|;/u)
    .map((text) => text.trim())
    .filter(Boolean);
  return (prose.length ? prose : ['']).slice(0, shelfPolicy.span_limit).map((text) => ({
    text: boundedText(text.trim(), shelfPolicy.span_chars),
    rank: null,
    orderObservable: false,
    listed: false,
  }));
}

/** Shelf matching applies its own casefold and punctuation rules, independently of brand aliases. */
function normalize(value: string) {
  return casefold(value)
    .replaceAll(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ');
}
export const productSchema = z.object({
  id: z.uuid(),
  canonical_url: z.string(),
  name: z.string(),
  brand: z.string(),
  gtin: z.string().nullish(),
  sku: z.string().nullish(),
  mpn: z.string().nullish(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export const competitorSchema = z.object({
  id: z.uuid(),
  canonical_url: z.string(),
  product_name: z.string(),
  brand_name: z.string(),
});
export const frozenTargetSchema = z.object({
  kind: z.enum(['product', 'category']),
  id: z.uuid(),
  products: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = productSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  approved_competitors: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = competitorSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type FrozenShelfTarget = z.output<typeof frozenTargetSchema>;
/** The products and approved competitors one answer is matched against. */
export type ShelfCatalog = Pick<FrozenShelfTarget, 'products' | 'approved_competitors'>;
type FrozenProduct = FrozenShelfTarget['products'][number];
export type ShelfMatch =
  | { product: FrozenProduct; competitor: null; confidence: number }
  | { product: null; competitor: FrozenShelfTarget['approved_competitors'][number]; confidence: 1 }
  | { product: null; competitor: null; confidence: 0 };
export const NO_MATCH: ShelfMatch = { product: null, competitor: null, confidence: 0 };

/** The catalog product or approved competitor whose page a carousel card links to. */
export function matchPageUrl(url: string, target: ShelfCatalog): ShelfMatch {
  const page = canonicalPage(url);
  if (!page) return NO_MATCH;
  const product = target.products.find((row) => canonicalPage(row.canonical_url) === page);
  if (product) return { product, competitor: null, confidence: 1 };
  const competitor = target.approved_competitors.find(
    (row) => canonicalPage(row.canonical_url) === page,
  );
  return competitor ? { product: null, competitor, confidence: 1 } : NO_MATCH;
}

/**
 * The catalog product or approved competitor the span names first.
 *
 * Names match whole tokens only, and identifiers shorter than the policy
 * minimum never match, so "Pro" or "10" cannot claim a sentence. A brand names
 * one owned product only together with an attribute value no other product of
 * that brand on the shelf shares. When a span names both sides ("Rival Y, a
 * cheaper alternative to Owned"), the one named first holds the slot.
 */
export function matchRecommendation(text: string, target: ShelfCatalog): ShelfMatch {
  const haystack = ` ${normalize(text)} `;
  const at = (value: string | null | undefined) => {
    const needle = normalize(value ?? '');
    if (needle.length < shelfPolicy.match_min_chars) return Infinity;
    const index = haystack.indexOf(` ${needle} `);
    return index < 0 ? Infinity : index;
  };
  const first = (values: Array<string | null | undefined>) => Math.min(...values.map(at));
  let best = { index: Infinity, match: NO_MATCH };
  const consider = (index: number, match: ShelfMatch) => {
    if (index < best.index) best = { index, match };
  };
  for (const product of target.products) {
    consider(first([product.canonical_url, product.gtin, product.sku, product.mpn, product.name]), {
      product,
      competitor: null,
      confidence: 1,
    });
    const brand = at(product.brand);
    if (
      brand < Infinity &&
      distinctiveAttributes(product, target).some((value) => at(value) < Infinity)
    )
      consider(brand, {
        product,
        competitor: null,
        confidence: shelfPolicy.brand_attribute_match_confidence,
      });
  }
  for (const competitor of target.approved_competitors)
    consider(first([competitor.canonical_url, competitor.product_name, competitor.brand_name]), {
      product: null,
      competitor,
      confidence: 1,
    });
  return best.match;
}

/** Textual attribute values no other same-brand product on the shelf carries. */
function distinctiveAttributes(product: FrozenProduct, target: ShelfCatalog) {
  const textual = (row: FrozenProduct) =>
    Object.values(row.attributes).flatMap((value) => {
      const normalized = typeof value === 'string' ? normalize(value) : '';
      return /\p{L}/u.test(normalized) && normalized.length >= shelfPolicy.attribute_min_chars
        ? [normalized]
        : [];
    });
  const brand = normalize(product.brand);
  const shared = new Set(
    target.products
      .filter((row) => row.id !== product.id && normalize(row.brand) === brand)
      .flatMap(textual),
  );
  return textual(product).filter((value) => !shared.has(value));
}

const resolvedRecommendationSchema = z.object({
  span: z.number().int().nonnegative(),
  title: z.string().min(1).max(512),
  brand: z.string().max(255).default(''),
  product_url: z.string().max(2048).default(''),
  merchant_url: z.string().max(2048).default(''),
  surface_kind: z.enum(['recommendation', 'shopping_result']).default('recommendation'),
});
export const resolvedBatchSchema = z.object({
  recommendations: z.array(resolvedRecommendationSchema),
});
type ResolvedRecommendation = z.output<typeof resolvedRecommendationSchema>;
/** One bounded model call per answer, over the numbered spans it is given. */
export type ShelfResolver = { model: string; resolve(spans: string[]): Promise<unknown> };
/**
 * What the optional resolver did for one span, each a distinct state:
 * `not_needed` (matched deterministically or no product signal, never sent),
 * `unavailable` (needed, but no resolver is configured), `failed` (the call
 * threw or returned malformed output), `omitted` (the call answered without
 * this span) and `resolved`.
 */
type ResolverOutcome = 'resolved' | 'omitted' | 'not_needed' | 'failed' | 'unavailable';
export type PreparedRecommendation = {
  span: RecommendationSpan;
  resolved: ResolvedRecommendation | null;
  /** The resolver model that was called for this span; empty when none was. */
  model: string;
  outcome: ResolverOutcome;
};

/** A span worth a resolver call: a list item, or prose carrying a link or a price. */
const hasProductSignal = (span: RecommendationSpan) =>
  span.listed ||
  /https?:\/\/|[$£€₹]\s*\d|\b(?:AUD|USD|CAD|NZD|GBP|EUR|INR)\s*\d/iu.test(span.text) ||
  // A capitalized word after the first names something ("Consider the Rival Runner").
  /\s\p{Lu}\p{L}/u.test(span.text);

/**
 * Deterministic matches first; the unmatched spans with a product signal go to
 * the resolver together, once. Unavailable or malformed output, or no
 * resolver, keeps every span as unresolved evidence.
 */
export async function prepareRecommendations(
  answer: string,
  target: ShelfCatalog,
  resolver?: ShelfResolver,
): Promise<PreparedRecommendation[]> {
  const spans = recommendationSpans(answer);
  const pending = spans.filter((span) => {
    const match = matchRecommendation(span.text, target);
    return !match.product && !match.competitor && hasProductSignal(span);
  });
  const resolved = new Map<RecommendationSpan, ResolvedRecommendation[]>();
  let failed = false;
  if (resolver && pending.length) {
    const startedAt = performance.now();
    try {
      const batch = resolvedBatchSchema.parse(
        await resolver.resolve(
          pending.map((span) => boundedText(span.text, shelfPolicy.span_chars)),
        ),
      );
      for (const item of batch.recommendations.slice(0, shelfPolicy.result_limit)) {
        const span = pending[item.span];
        if (span) resolved.set(span, [...(resolved.get(span) ?? []), item]);
      }
    } catch (error) {
      // Optional classification cannot erase unresolved evidence; the failure is recorded.
      getLogger('commerce.shelf').warning('commerce_shelf_resolution_failed', {
        model: resolver.model,
        spans: pending.length,
        ...failureFacts(error),
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      failed = true;
    }
  }
  const unresolved = (span: RecommendationSpan): PreparedRecommendation => {
    if (!pending.includes(span)) return { span, resolved: null, model: '', outcome: 'not_needed' };
    if (!resolver) return { span, resolved: null, model: '', outcome: 'unavailable' };
    return { span, resolved: null, model: resolver.model, outcome: failed ? 'failed' : 'omitted' };
  };
  return spans.flatMap((span): PreparedRecommendation[] => {
    const items = resolved.get(span);
    if (!resolver || !items?.length) return [unresolved(span)];
    // A span resolved into several products keeps no single rank.
    const shown = items.length > 1 ? { ...span, rank: null, orderObservable: false } : span;
    return items.map((item): PreparedRecommendation => ({
      span: shown,
      resolved: item,
      model: resolver.model,
      outcome: 'resolved',
    }));
  });
}

const OBSERVED_PRICE = new RegExp(
  String.raw`([$£€₹]|AUD|USD|CAD|NZD|GBP|EUR|INR)\s*(\d[${AMOUNT_CHARACTERS}]*)`,
  'iu',
);
export function observedPrice(
  span: string,
  locale: string,
): { price: number | null; currency: string } {
  const [, symbol, amount] = OBSERVED_PRICE.exec(span) ?? [];
  if (symbol === undefined || amount === undefined) return { price: null, currency: '' };
  const marker = symbol.toUpperCase();
  const currencies = new Set(
    locale
      .toUpperCase()
      .split(/[-_]/u)
      .flatMap((part) => {
        const value =
          shelfPolicy.dollar_currencies[part as keyof typeof shelfPolicy.dollar_currencies];
        return value ? [value] : [];
      }),
  );
  const currency =
    marker === '$'
      ? (onlyOf(currencies) ?? '')
      : ({ '£': 'GBP', '€': 'EUR', '₹': 'INR' }[marker] ?? marker);
  return { price: localizedPrice(amount), currency };
}
export function observedMerchant(span: string, resolved?: string) {
  const url = resolved?.trim() || /https?:\/\/[^\s)\]}>,]+/iu.exec(span)?.[0] || '';
  try {
    return { url, domain: new URL(url).hostname.toLowerCase() };
  } catch {
    return { url, domain: '' };
  }
}
/**
 * A resolved PDP becomes an AI-observed competitor only when the answer itself
 * carries that URL, the URL is not merely a citation, and it is not on the
 * business's own site. A URL the resolver supplied on its own is not evidence.
 */
export function resolvedCompetitorUrl(
  url: string,
  evidence: { answer: string; citations: string[]; ownedHosts: string[] },
): string | null {
  const canonical = canonicalPage(url);
  if (!canonical || evidence.citations.some((value) => canonicalPage(value) === canonical))
    return null;
  // Sentence punctuation after a URL is not part of it.
  const inAnswer = (evidence.answer.match(/https?:\/\/[^\s)\]}>,"']+/giu) ?? []).some(
    (value) => canonicalPage(stripTrailing(value, '.;:!?')) === canonical,
  );
  return inAnswer ? competitorPageUrl(canonical, evidence.ownedHosts) : null;
}
/**
 * A product page that may stand for an AI-observed competitor: a web page off
 * the business's own hosts, not a known non-product host or path.
 */
export function competitorPageUrl(url: string, ownedHosts: string[]): string | null {
  const canonical = canonicalPage(url);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const within = (domains: readonly string[]) =>
    domains.some((domain) => domainMatches(parsed.hostname, domain));
  if (within(shelfPolicy.non_pdp_hosts) || within(ownedHosts)) return null;
  if (shelfPolicy.excluded_paths.some((token) => parsed.pathname.toLowerCase().includes(token)))
    return null;
  return canonical;
}
