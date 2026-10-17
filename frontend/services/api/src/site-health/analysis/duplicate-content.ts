/**
 * Exact and near-duplicate main content across one crawl's analyzed pages.
 * Lexical only: a SHA-256 of the normalized word sequence for exact copies and
 * a 64-bit SimHash over word shingles for near copies, compared pairwise
 * (crawls analyze at most a few hundred pages).
 */
import { createHash } from 'node:crypto';
import { policy } from '../../config.ts';
import { compareText } from '../../text-order.ts';
import { finalizeEvaluation } from './finalize.ts';

const settings = policy.site_health.page_analysis.rules.duplicate_content;
const limits = policy.site_health.page_analysis.facts.limits;

export type Fingerprint = { exact: string; words: number; low: number; high: number };

/** FNV-1a over the shingle's characters, then a murmur3 finalizer seeded per half. */
function shingleHash(value: string, seed: number) {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.codePointAt(index)!;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  hash ^= seed;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85_eb_ca_6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2_b2_ae_35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function popcount(value: number) {
  let bits = value - ((value >>> 1) & 0x55_55_55_55);
  bits = (bits & 0x33_33_33_33) + ((bits >>> 2) & 0x33_33_33_33);
  return (Math.imul((bits + (bits >>> 4)) & 0x0f_0f_0f_0f, 0x01_01_01_01) >>> 24) & 0xff;
}

const hammingDistance = (left: Fingerprint, right: Fingerprint) =>
  popcount(left.low ^ right.low) + popcount(left.high ^ right.high);

/** The page's main-content fingerprint, or null when it has too few words to compare. */
export function contentFingerprint(text: string): Fingerprint | null {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length < settings.min_words) return null;
  const width = Math.min(settings.shingle_words, tokens.length);
  const shingles = new Set<string>();
  for (let index = 0; index + width <= tokens.length; index++)
    shingles.add(tokens.slice(index, index + width).join(' '));
  const weights = new Int32Array(64);
  for (const shingle of shingles) {
    const halves = [shingleHash(shingle, 0x9e_37_79_b9), shingleHash(shingle, 0x7f_4a_7c_15)];
    for (let bit = 0; bit < 64; bit++)
      weights[bit]! += (halves[bit >> 5]! >>> (bit & 31)) & 1 ? 1 : -1;
  }
  let low = 0;
  let high = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) low |= 1 << bit;
    if (weights[bit + 32]! > 0) high |= 1 << bit;
  }
  return {
    exact: createHash('sha256').update(tokens.join(' ')).digest('hex'),
    words: tokens.length,
    low: low >>> 0,
    high: high >>> 0,
  };
}

export type DuplicateMatch = { url: string; match: 'exact' | 'near'; distance: number };

/** Each URL's duplicates among the others, closest first. */
export function duplicateMatches(pages: ReadonlyMap<string, Fingerprint>) {
  const entries = [...pages];
  const matches = new Map<string, DuplicateMatch[]>(entries.map(([url]) => [url, []]));
  for (let left = 0; left < entries.length; left++) {
    const [leftUrl, leftPrint] = entries[left]!;
    for (let right = left + 1; right < entries.length; right++) {
      const [rightUrl, rightPrint] = entries[right]!;
      const exact = leftPrint.exact === rightPrint.exact;
      const distance = exact ? 0 : hammingDistance(leftPrint, rightPrint);
      if (!exact && distance > settings.max_hamming_distance) continue;
      const match = exact ? 'exact' : 'near';
      matches.get(leftUrl)!.push({ url: rightUrl, match, distance });
      matches.get(rightUrl)!.push({ url: leftUrl, match, distance });
    }
  }
  for (const list of matches.values())
    list.sort((a, b) => a.distance - b.distance || compareText(a.url, b.url));
  return matches;
}

export type DuplicateComparison =
  | { kind: 'excluded'; reason: string }
  | { kind: 'compared'; words: number; compared: number; matches: DuplicateMatch[] };

/** One page's duplicate-content evaluation; an excluded page names why it was not compared. */
export function duplicateContent(input: DuplicateComparison) {
  const rule = 'technical.duplicate_content';
  if (input.kind === 'excluded')
    return finalizeEvaluation(rule, 'not_applicable', { reason: input.reason });
  const evidence = {
    word_count: input.words,
    compared_count: input.compared,
    max_hamming_distance: settings.max_hamming_distance,
    duplicates: input.matches
      .slice(0, limits.evidence_urls)
      .map((match) => ({ ...match, url: match.url.slice(0, limits.url_chars) })),
  };
  return input.matches.length
    ? finalizeEvaluation(rule, 'missing', {
        ...evidence,
        reason: input.matches.some((match) => match.match === 'exact')
          ? 'exact_duplicate'
          : 'near_duplicate',
      })
    : finalizeEvaluation(rule, 'satisfied', evidence);
}
