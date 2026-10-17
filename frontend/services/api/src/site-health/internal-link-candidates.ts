import { randomUUID } from 'node:crypto';
import type { InternalLinkPage, InternalLinkPlacement } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import { sourcePlacements } from './internal-link-placements.ts';

const limits = policy.internal_links;
const stopWords = new Set<string>(limits.stop_words);

export type LinkCandidate = {
  id: string;
  source: string;
  target: string;
  /** The destination's key in its source page's JEV request (`targets.<key>`). */
  key: string;
  similarity: number;
  placements: InternalLinkPlacement[];
};

/** One JEV request per source page: its targets share the source state. */
export type LinkRequest = {
  id: string;
  candidates: { id: string; key: string }[];
  request: { state: Record<string, unknown>; questions: Record<string, unknown> };
};

function path(url: string): string {
  const pathname = new URL(url).pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** A page title without its site-name suffix. */
function pageName(title: string): string {
  return title.split(/\s[|\-–—]\s/u)[0]!.trim();
}

function terms(page: InternalLinkPage): string[] {
  const slug = path(page.url).replaceAll(/[/_-]+/gu, ' ');
  return (
    `${page.title} ${page.h1} ${slug} ${page.description}`
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) ?? []
  ).filter((word) => !stopWords.has(word));
}

function passageVector(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    if (!stopWords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const norm = Math.hypot(...counts.values()) || 1;
  return new Map([...counts].map(([word, count]) => [word, count / norm]));
}

/** Unit-length TF-IDF vectors; site-wide template words carry no weight. */
function vectors(pages: InternalLinkPage[]) {
  const tokens = new Map(pages.map((page) => [page.analysis_id, terms(page)]));
  const frequency = new Map<string, number>();
  for (const words of tokens.values())
    for (const word of new Set(words)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const result = new Map<string, Map<string, number>>();
  for (const page of pages) {
    const counts = new Map<string, number>();
    for (const word of tokens.get(page.analysis_id)!) {
      const df = frequency.get(word)!;
      if (
        pages.length >= limits.common_term_min_pages &&
        df > pages.length * limits.common_term_fraction
      )
        continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const weighted = new Map(
      [...counts].map(([word, count]) => [
        word,
        count * Math.log(1 + pages.length / frequency.get(word)!),
      ]),
    );
    const norm = Math.hypot(...weighted.values()) || 1;
    result.set(page.analysis_id, new Map([...weighted].map(([word, x]) => [word, x / norm])));
  }
  return result;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [word, x] of small) sum += x * (large.get(word) ?? 0);
  return sum;
}

const titleWords = (page: InternalLinkPage) =>
  new Set(
    pageName(page.title)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );

/** Colour/size variants of one product, which a contextual link would not help. */
export function isVariant(a: InternalLinkPage, b: InternalLinkPage): boolean {
  if (a.page_kind !== 'product' || b.page_kind !== 'product') return false;
  const left = titleWords(a);
  const right = titleWords(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  const different = left.size + right.size - 2 * shared;
  return shared >= 2 && different <= limits.variant_max_word_difference;
}

function pageState(page: InternalLinkPage) {
  return {
    title: page.title,
    h1: page.h1,
    url: path(page.url),
    page_type: page.page_kind,
    description: page.description,
    content: page.excerpt,
  };
}

const targetPath = (key: string) => `targets.${key}`;

function linkRequest(source: InternalLinkPage, targets: [LinkCandidate, InternalLinkPage][]) {
  const questions: Record<string, unknown> = {};
  const state: Record<string, unknown> = {};
  for (const [candidate, target] of targets) {
    const path = targetPath(candidate.key);
    state[candidate.key] = {
      ...pageState(target),
      contextual_inbound_links: target.contextual_inbound,
      placements: Object.fromEntries(
        candidate.placements.map((placement, index) => [`a${index}`, placement]),
      ),
    };
    questions[`link_${candidate.key}`] = {
      type: 'noul',
      instructions: limits.link_instructions.replaceAll('{target}', path),
      criteria: limits.link_criteria,
    };
    questions[`anchor_${candidate.key}`] = {
      type: 'choice',
      instructions: limits.anchor_instructions.replaceAll('{target}', path),
      criteria: {
        ...Object.fromEntries(
          candidate.placements.map((_placement, index) => [
            `a${index}`,
            `The exact source phrase and passage at \`${path}.placements.a${index}\``,
          ]),
        ),
        none: limits.no_placement_description,
      },
    };
  }
  return { state: { rubric: limits.rubric, source: pageState(source), targets: state }, questions };
}

/**
 * Group each source page's shortlist into one JEV request: the source and
 * rubric are sent once, with a link (and anchor) question per destination.
 */
export function linkRequests(
  pages: InternalLinkPage[],
  candidates: LinkCandidate[],
): LinkRequest[] {
  const byId = new Map(pages.map((page) => [page.analysis_id, page]));
  const grouped = Map.groupBy(candidates, (candidate) => candidate.source);
  return [...grouped].map(([sourceId, shortlist]) => ({
    id: randomUUID(),
    candidates: shortlist.map(({ id, key }) => ({ id, key })),
    request: linkRequest(
      byId.get(sourceId)!,
      shortlist.map((candidate) => [candidate, byId.get(candidate.target)!]),
    ),
  }));
}

/** Shortlist the most related unlinked destinations for every source page. */
export function linkCandidates(pages: InternalLinkPage[]): LinkCandidate[] {
  // Destination labels identify an anchor's subject; sales descriptions must not
  // turn generic phrases such as "crafted with care" into linkable entities.
  const vector = vectors(pages.map((page) => ({ ...page, description: '' })));
  const candidates: LinkCandidate[] = [];
  for (const source of pages) {
    const capturedPassages = source.source_passages;
    if (!source.links_complete || !capturedPassages?.length) continue;
    const linked = new Set(source.contextual_targets);
    const passages = capturedPassages.map((passage) => passageVector(passage.text));
    const ranked = pages
      .filter(
        (target) =>
          target.eligible_target &&
          target.url !== source.url &&
          !linked.has(target.url) &&
          !isVariant(source, target),
      )
      .map((target) => ({
        target,
        similarity: Math.max(
          ...passages.map((passage) => cosine(passage, vector.get(target.analysis_id)!)),
        ),
        placements: sourcePlacements(
          capturedPassages,
          new Set(vector.get(target.analysis_id)!.keys()),
          [target.h1, pageName(target.title)],
        ),
      }))
      .filter((item) => item.placements.length > 0)
      .toSorted((a, b) => b.similarity - a.similarity || a.target.url.localeCompare(b.target.url));
    const chosen: InternalLinkPage[] = [];
    for (const { target, similarity, placements } of ranked) {
      if (chosen.length >= limits.targets_per_page) break;
      // One destination per product family: its variants would repeat the suggestion.
      if (chosen.some((page) => isVariant(page, target))) continue;
      candidates.push({
        id: randomUUID(),
        source: source.analysis_id,
        target: target.analysis_id,
        key: `t${chosen.length}`,
        similarity,
        placements,
      });
      chosen.push(target);
    }
  }
  return candidates;
}
