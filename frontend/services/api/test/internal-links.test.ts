import { describe, expect, it } from 'vitest';
import type { InternalLinkPage } from '@citeladder/contracts/site-health';
import {
  internalLinkAnalysisSchema,
  internalLinkPageSchema,
  internalLinkSchema,
} from '@citeladder/contracts/site-health';

import {
  isVariant,
  linkCandidates,
  linkRequests,
} from '../src/site-health/internal-link-candidates.ts';
import { projectLinks } from '../src/site-health/internal-link-publish.ts';
import { policy } from '../src/config.ts';
import { contextualLinkObserved } from '../src/opportunities/internal-link-verification.ts';
import { linkUrl } from '../src/site-health/internal-link-pages.ts';
import { sourcePassages, sourcePlacements } from '../src/site-health/internal-link-placements.ts';

let counter = 0;
function page(title: string, overrides: Partial<InternalLinkPage> = {}): InternalLinkPage {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return {
    analysis_id: id,
    artifact_id: id,
    site_url_id: id,
    url: `https://example.com/${slug}`,
    title: `${title} | Acme`,
    h1: title,
    description: '',
    excerpt: '',
    source_passages: sourcePassages(
      `${title} can help you make informed decisions about this subject.`,
    ),
    page_kind: 'article',
    contextual_inbound: 0,
    contextual_targets: [],
    links_complete: true,
    eligible_target: true,
    extractor_version: '1',
    ...overrides,
  };
}
const pairs = (pages: InternalLinkPage[]) =>
  linkCandidates(pages).map((candidate) => [candidate.source, candidate.target]);

describe('internal link candidates', () => {
  it('suggests related unlinked pages and never a self, linked or ineligible destination', () => {
    const source = page('Garden soil testing guide');
    const related = page('Soil testing kit');
    const linked = page('Soil testing compost');
    const noindex = page('Soil testing chart', { eligible_target: false });
    source.contextual_targets = [linked.url];
    const found = pairs([source, related, linked, noindex]).filter(
      ([from]) => from === source.analysis_id,
    );
    expect(found).toEqual([[source.analysis_id, related.analysis_id]]);
  });

  it('makes no suggestion from a page whose link capture was truncated', () => {
    const source = page('Garden soil guide', { links_complete: false });
    const target = page('Soil testing kit');
    expect(pairs([source, target]).some(([from]) => from === source.analysis_id)).toBe(false);
  });

  it('skips colour variants of the same product and keeps one destination per product family', () => {
    const product = (title: string, overrides: Partial<InternalLinkPage> = {}) =>
      page(title, { page_kind: 'product', ...overrides });
    const source = product('Black Hi-Cut Cotton Bikini', {
      source_passages: sourcePassages(
        'Compare the white hi-cut cotton bikini with the black lace front bikini and the white lace front bikini.',
      ),
    });
    const variant = product('White Hi-Cut Cotton Bikini');
    const familyA = product('Black Lace Front Bikini');
    const familyB = product('White Lace Front Bikini');
    expect(isVariant(source, variant)).toBe(true);
    const targets = pairs([source, variant, familyA, familyB])
      .filter(([from]) => from === source.analysis_id)
      .map(([, to]) => to);
    expect(targets).not.toContain(variant.analysis_id);
    expect(targets).toHaveLength(1);
    expect([familyA.analysis_id, familyB.analysis_id]).toContain(targets[0]);
  });

  it('gives every source page its own destination budget', () => {
    // Each word is on five pages, so every page shares a two-word phrase with six neighbours.
    const words =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa'.split(
        ' ',
      );
    const pages = words.map((_, index) =>
      page([0, 1, 2, 3, 4].map((offset) => words[(index + offset) % words.length]).join(' ')),
    );
    const candidates = linkCandidates(pages);
    for (const source of pages)
      expect(candidates.filter((item) => item.source === source.analysis_id)).toHaveLength(
        policy.internal_links.targets_per_page,
      );
  });

  it('retrieves a destination from an exact source phrase even without title overlap', () => {
    const target = page('Autocapture');
    const text =
      'Start by enabling autocapture to collect clicks and pageviews in your application.';
    const pages = [page('Getting started', { source_passages: sourcePassages(text) }), target];
    const candidate = linkCandidates(pages).find((item) => item.target === target.analysis_id)!;
    expect(candidate.placements).toEqual([
      {
        text,
        start: 0,
        end: text.length,
        anchor: 'autocapture',
        anchor_start: text.indexOf('autocapture'),
      },
    ]);
    const [request] = linkRequests(pages, [candidate]);
    const question = request!.request.questions[`anchor_${candidate.key}`] as {
      criteria: Record<string, unknown>;
    };
    expect(Object.keys(question.criteria)).toEqual(['a0', 'none']);
    expect(question.criteria.none).toBeDefined();
  });

  it('does not substitute metadata or destination labels for missing source prose', () => {
    const source = page('Garden soil guide', { source_passages: [] });
    const target = page('Soil testing kit');
    expect(pairs([source, target]).some(([from]) => from === source.analysis_id)).toBe(false);
    source.source_passages = null;
    expect(pairs([source, target]).some(([from]) => from === source.analysis_id)).toBe(false);
    source.source_passages = sourcePassages(
      'This article explains how to prepare seedlings for the growing season.',
    );
    expect(pairs([source, target]).some(([from]) => from === source.analysis_id)).toBe(false);
  });

  it('distinguishes unavailable source evidence from captured text without usable passages', () => {
    const captured = page('Garden soil guide', { source_passages: [] });
    expect(internalLinkPageSchema.parse(captured).source_passages).toEqual([]);
    expect(
      internalLinkPageSchema.parse({ ...captured, source_passages: null }).source_passages,
    ).toBeNull();
    expect(
      internalLinkPageSchema.safeParse({ ...captured, source_passages: undefined }).success,
    ).toBe(false);
  });

  it('keeps exact offsets beyond the excerpt and excludes flattened headings', () => {
    const intro =
      'This introductory sentence provides some general background for the reader. '.repeat(8);
    const heading = 'F45 TRAINING LIONHEART';
    const sentence = 'LionHeart is more than a heart rate monitor for your workout.';
    const text = `${intro}${heading} ${sentence}`;
    const passages = sourcePassages(text, [heading]);
    expect(passages.at(-1)).toEqual({
      text: sentence,
      start: text.indexOf(sentence),
      end: text.length,
    });
    expect(
      sourcePassages('Contents Trends Funnels Retention Was this page useful?', [
        'Contents',
        'Was this page useful?',
      ]),
    ).toEqual([]);
  });

  it('anchors a destination by a phrase or its one-word name, never a lone shared topic word', () => {
    const passages = sourcePassages(
      'Track your AI visibility across engines and compare pricing before you upgrade.',
    );
    const anchors = (terms: string[], names: string[]) =>
      sourcePlacements(passages, new Set(terms), names).map((placement) => placement.anchor);
    expect(anchors(['visibility', 'report'], ['Visibility report'])).toEqual([]);
    expect(anchors(['ai', 'visibility'], ['AI visibility'])).toEqual(['AI visibility']);
    expect(anchors(['pricing', 'plans'], ['Pricing'])).toEqual(['pricing']);
  });

  it('never takes a flattened label/value widget as source prose', () => {
    expect(
      sourcePassages('Visibility Visibility shows how often each engine cites your brand.'),
    ).toEqual([]);
  });

  it('sends each source page once with a question per destination it names', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel'.split(' ');
    const pages = words.map((_, index) =>
      page([0, 1, 2, 3].map((offset) => words[(index + offset) % words.length]).join(' ')),
    );
    const candidates = linkCandidates(pages);
    const requests = linkRequests(pages, candidates);
    expect(requests).toHaveLength(new Set(candidates.map((item) => item.source)).size);
    expect(requests.flatMap((item) => item.candidates.map(({ id }) => id)).sort()).toEqual(
      candidates.map(({ id }) => id).sort(),
    );
    for (const { candidates: members, request } of requests) {
      const targets = request.state.targets as Record<string, { url: string }>;
      for (const { id, key } of members) {
        const candidate = candidates.find((item) => item.id === id)!;
        const target = pages.find((item) => item.analysis_id === candidate.target)!;
        expect(targets[key]!.url).toBe(new URL(target.url).pathname);
        const link = request.questions[`link_${key}`] as { instructions: string };
        expect(link.instructions).toContain(`targets.${key}`);
      }
    }
  });
});

describe('internal link publication', () => {
  const source = page('Garden soil guide', {
    source_passages: sourcePassages(
      'Use a soil testing kit to check whether garden soil needs compost.',
    ),
  });
  const target = page('Soil testing kit', { h1: 'Home soil testing' });
  const manifest = {
    pages: [source, target],
    candidates: linkCandidates([source, target]),
    policy: policy.internal_links,
    omitted_pages: 0,
  };
  const completed = (noul: number, anchor?: unknown) => ({
    state: 'completed',
    answers: { link: { type: 'noul', noul }, anchor },
  });
  const outcomes = (value: unknown) =>
    new Map(manifest.candidates.map((candidate) => [candidate.id, value]));

  it('keeps pending, unavailable, empty and partial results distinct', () => {
    expect(projectLinks(manifest, new Map()).state).toBe('running');
    const unavailable = projectLinks(
      manifest,
      outcomes({ state: 'unavailable', reason: 'funding_unavailable' }),
    );
    expect(unavailable.state).toBe('unavailable');
    expect(unavailable.diagnostics.reasons.funding_unavailable).toBe(manifest.candidates.length);
    const rejected = projectLinks(manifest, outcomes(completed(0.1)));
    expect(rejected.state).toBe('completed');
    expect(rejected.recommendations).toEqual([]);
    expect(rejected.diagnostics.below_threshold).toBe(manifest.candidates.length);
    expect(projectLinks({ ...manifest, omitted_pages: 3 }, outcomes(completed(0.1))).state).toBe(
      'partial',
    );
  });

  it('publishes only explicit source placements and never falls back on invalid answers', () => {
    const chosen = projectLinks(
      manifest,
      outcomes(completed(0.9, { type: 'choice', choice: 'a0' })),
    );
    const toTarget = (result: ReturnType<typeof projectLinks>) =>
      result.recommendations.find((link) => link.target.analysis_id === target.analysis_id)!;
    expect(toTarget(chosen).anchor).toBe('soil testing kit');
    expect(toTarget(chosen).placement?.text).toBe(source.source_passages![0]!.text);
    const malformed = projectLinks(manifest, outcomes(completed(0.9, { choice: 'none' })));
    expect(malformed.recommendations).toEqual([]);
    expect(malformed.state).toBe('unavailable');
    const none = projectLinks(
      manifest,
      outcomes(completed(0.9, { type: 'choice', choice: 'none' })),
    );
    expect(none.recommendations).toEqual([]);
    expect(none.state).toBe('completed');
    expect(
      projectLinks(manifest, outcomes(completed(0.9, { type: 'choice', choice: 'a99' }))).state,
    ).toBe('unavailable');
  });

  it('rejects a selected anchor whose offsets do not match frozen source evidence', () => {
    const altered = structuredClone(manifest);
    for (const candidate of altered.candidates) candidate.placements[0]!.anchor_start += 1;
    const result = projectLinks(
      altered,
      outcomes(completed(0.99, { type: 'choice', choice: 'a0' })),
    );
    expect(result.recommendations).toEqual([]);
    expect(result.state).toBe('unavailable');
  });

  it('keeps distinct phrases but chooses one destination for overlapping anchor spans', () => {
    const competing = page('Soil testing methods');
    const compost = page('Compost');
    const pages = [source, target, competing, compost];
    const candidates = linkCandidates(pages).filter(
      (candidate) => candidate.source === source.analysis_id,
    );
    const decisions = new Map(
      candidates.map((candidate) => [
        candidate.id,
        completed(candidate.target === target.analysis_id ? 0.95 : 0.8, {
          type: 'choice',
          choice: 'a0',
        }),
      ]),
    );
    const result = projectLinks({ ...manifest, pages, candidates }, decisions);
    expect(result.recommendations.map((link) => link.target.analysis_id)).toEqual([
      target.analysis_id,
      compost.analysis_id,
    ]);
    expect(result.diagnostics.reasons.overlapping_placement).toBe(1);
  });

  it('keeps only the most useful links into one destination', () => {
    const sources = Array.from({ length: 4 }, (_, index) =>
      page(`Garden bed plan ${index}`, {
        source_passages: sourcePassages(
          `Bed ${index} needs a soil testing kit before any planting starts this spring.`,
        ),
      }),
    );
    const pages = [...sources, target];
    const candidates = linkCandidates(pages).filter(
      (candidate) => candidate.target === target.analysis_id,
    );
    const usefulness = new Map(
      sources.map((item, index) => [item.analysis_id, 0.9 - index * 0.05]),
    );
    const decisions = new Map(
      candidates.map((candidate) => [
        candidate.id,
        completed(usefulness.get(candidate.source)!, { type: 'choice', choice: 'a0' }),
      ]),
    );
    const result = projectLinks(
      {
        ...manifest,
        pages,
        candidates,
        policy: { ...policy.internal_links, max_links_per_target: 2 },
      },
      decisions,
    );
    expect(result.recommendations.map((link) => link.source.analysis_id)).toEqual([
      sources[0]!.analysis_id,
      sources[1]!.analysis_id,
    ]);
    expect(result.diagnostics.reasons.target_cap).toBe(2);
  });

  it('reads historical saved suggestions without inventing placement evidence', () => {
    const saved = internalLinkSchema.parse({
      id: source.analysis_id,
      source,
      target,
      anchor: 'Legacy label',
      usefulness: 0.8,
      action_id: null,
      action_status: null,
    });
    expect(saved.placement).toBeUndefined();
    expect(saved.anchor).toBe('Legacy label');
    const { sources_without_passages: _coverage, ...diagnostics } = projectLinks(
      manifest,
      new Map(),
    ).diagnostics;
    expect(
      internalLinkAnalysisSchema.shape.diagnostics.parse(diagnostics)?.sources_without_passages,
    ).toBeNull();
  });
});

describe('internal link URLs', () => {
  it('drops click-tracking parameters but keeps meaningful query identity', () => {
    expect(linkUrl('/shop?srsltid=abc&utm_source=x&color=red#top', 'https://example.com/')).toBe(
      'https://example.com/shop?color=red',
    );
  });
});

describe('internal link verification', () => {
  it('accepts any main-content link to the destination and detects its removal', () => {
    const check = { target_url: 'https://example.com/soil', extractor_version: '1' };
    const facts = {
      extraction: { state: 'available', truncated: false },
      extractor_version: '1',
      delivery: { final_url: 'https://example.com/garden' },
      links: {
        anchors_truncated: false,
        anchors: [{ url: '/soil', anchor_text: 'reworded', region: 'nav' }],
      },
    };
    expect(contextualLinkObserved(facts, check)).toBe(false);
    facts.links.anchors[0]!.region = 'main';
    expect(contextualLinkObserved(facts, check)).toBe(true);
    facts.links.anchors[0]!.region = 'unknown';
    expect(contextualLinkObserved(facts, check)).toBeNull();
    facts.links.anchors = [];
    expect(contextualLinkObserved(facts, check)).toBe(false);
    facts.links.anchors_truncated = true;
    expect(contextualLinkObserved(facts, check)).toBeNull();
  });
});
