import { createHash } from 'node:crypto';
import { policy } from '../../config.ts';
import { compareText } from '../../text-order.ts';
import { finalizeEvaluation } from './finalize.ts';

const settings = policy.site_health.page_analysis.rules.duplicate_content;
const limits = policy.site_health.page_analysis.facts.limits;

export type Fingerprint = { exact: string; words: number; low: number; high: number };

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

type Group = { print: Fingerprint; exact: Map<string, string[]>; near: Map<Group, number> };
const printKey = (print: Fingerprint) => `${print.low}:${print.high}`;

function bands(print: Fingerprint) {
  const count = settings.max_hamming_distance + 1;
  const keys = Array.from({ length: count }, (_, band) => `${band}:`);
  for (let bit = 0; bit < 64; bit++)
    keys[Math.floor((bit * count) / 64)] += String(
      ((bit < 32 ? print.low : print.high) >>> (bit & 31)) & 1,
    );
  return keys;
}

const closest = (a: DuplicateMatch, b: DuplicateMatch) =>
  a.distance - b.distance ||
  Number(b.match === 'exact') - Number(a.match === 'exact') ||
  compareText(a.url, b.url);

function groupByPrint(pages: ReadonlyMap<string, Fingerprint>) {
  const groups = new Map<string, Group>();
  for (const [url, print] of pages) {
    const group = groups.get(printKey(print)) ?? { print, exact: new Map(), near: new Map() };
    const copies = group.exact.get(print.exact) ?? [];
    copies.push(url);
    group.exact.set(print.exact, copies);
    groups.set(printKey(print), group);
  }
  for (const group of groups.values())
    for (const urls of group.exact.values()) urls.sort(compareText);
  return groups;
}

function linkNearGroups(groups: Iterable<Group>) {
  const buckets = new Map<string, Group[]>();
  for (const group of groups)
    for (const band of bands(group.print)) {
      const bucket = buckets.get(band) ?? [];
      for (const other of bucket) {
        if (group.near.has(other)) continue;
        const distance = hammingDistance(group.print, other.print);
        if (distance > settings.max_hamming_distance) continue;
        group.near.set(other, distance);
        other.near.set(group, distance);
      }
      bucket.push(group);
      buckets.set(band, bucket);
    }
}

export function duplicateMatches(pages: ReadonlyMap<string, Fingerprint>) {
  const groups = groupByPrint(pages);
  linkNearGroups(groups.values());
  return (url: string): DuplicateMatch[] => {
    const print = pages.get(url);
    const group = print && groups.get(printKey(print));
    if (!print || !group) return [];
    const found: DuplicateMatch[] = [];
    const take = (urls: string[], match: DuplicateMatch['match'], distance: number) => {
      let taken = 0;
      for (const other of urls) {
        if (taken >= limits.evidence_urls) return;
        if (other === url) continue;
        found.push({ url: other, match, distance });
        taken++;
      }
    };
    for (const [hash, urls] of group.exact) take(urls, hash === print.exact ? 'exact' : 'near', 0);
    for (const [other, distance] of group.near)
      for (const urls of other.exact.values()) take(urls, 'near', distance);
    return found.toSorted(closest).slice(0, limits.evidence_urls);
  };
}

export type DuplicateComparison =
  | { kind: 'excluded'; reason: string }
  | { kind: 'compared'; words: number; compared: number; matches: DuplicateMatch[] };

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
