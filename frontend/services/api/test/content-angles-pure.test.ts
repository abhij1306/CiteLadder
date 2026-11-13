/**
 * Content-angle lineage, the clustering request, aggregation and output
 * validation: pure functions, no database.
 */
import { describe, expect, it } from 'vitest';

import { aggregateAngle } from '../src/content-gaps/aggregate.ts';
import { assignLineages } from '../src/content-gaps/lineage.ts';
import type { CitedUrl } from '../src/content-gaps/load.ts';
import { clusterPrompt } from '../src/content-gaps/model.ts';
import { validateAngles, validateMatches } from '../src/content-gaps/validate.ts';

const url = (canonicalUrl: string, values: Partial<CitedUrl> = {}): CitedUrl => ({
  topicId: 't1',
  canonicalUrl,
  urlHash: canonicalUrl,
  title: canonicalUrl,
  titleFromSlug: false,
  domain: new URL(canonicalUrl).hostname,
  classification: 'third_party',
  matchedCompetitor: null,
  sourceClass: 'editorial_third_party',
  citations: [],
  ...values,
});

describe('assignLineages', () => {
  const previous = [
    { lineageId: 'L1', topicId: 't1', memberUrls: ['a', 'b', 'c', 'd', 'e'] },
    { lineageId: 'L2', topicId: 't1', memberUrls: ['x', 'y'] },
    { lineageId: 'L3', topicId: 't2', memberUrls: ['a', 'b', 'c', 'd', 'e'] },
  ];

  it('keeps the lineage at 60% overlap and starts a new one below the minimum', () => {
    const lineages = assignLineages(
      previous,
      [
        // 3 shared of 5 total: Jaccard 0.6.
        { key: 'relabelled', topicId: 't1', memberUrls: ['a', 'b', 'c'] },
        // 1 shared of 3 total: Jaccard 0.33.
        { key: 'drifted', topicId: 't1', memberUrls: ['x', 'z'] },
      ],
      0.5,
    );
    expect(Object.fromEntries(lineages)).toEqual({ relabelled: 'L1', drifted: null });
  });

  it('matches within a topic only, one-to-one, best overlap first', () => {
    const lineages = assignLineages(
      previous,
      [
        { key: 'partial', topicId: 't1', memberUrls: ['a', 'b', 'c', 'd'] },
        { key: 'exact', topicId: 't1', memberUrls: ['a', 'b', 'c', 'd', 'e'] },
        { key: 'other-topic', topicId: 't2', memberUrls: ['a', 'b', 'c', 'd', 'e'] },
        { key: 'topicless', topicId: null, memberUrls: ['a', 'b', 'c', 'd', 'e'] },
      ],
      0.5,
    );
    expect(Object.fromEntries(lineages)).toEqual({
      partial: null,
      exact: 'L1',
      'other-topic': 'L3',
      topicless: null,
    });
  });

  it('breaks an overlap tie by the lower lineage ID', () => {
    const lineages = assignLineages(
      [
        { lineageId: 'L9', topicId: 't1', memberUrls: ['a', 'b'] },
        { lineageId: 'L4', topicId: 't1', memberUrls: ['a', 'b'] },
      ],
      [{ key: 'new', topicId: 't1', memberUrls: ['a', 'b'] }],
      0.5,
    );
    expect(lineages.get('new')).toBe('L4');
  });
});

describe('clusterPrompt', () => {
  it('sends each page with its URL path and asks for content pages only', () => {
    const request = clusterPrompt({
      language: 'en',
      maxLabelChars: 60,
      urls: [
        url('https://globex.com/blog/crm-setup-guide?utm_source=x', { title: 'CRM setup guide' }),
        url('https://shop.example/collections/crm', { title: 'CRM software' }),
      ],
    });
    expect(JSON.parse(request.user)).toEqual({
      language: 'en',
      pages: [
        { id: 'u1', title: 'CRM setup guide', domain: 'globex.com', path: '/blog/crm-setup-guide' },
        { id: 'u2', title: 'CRM software', domain: 'shop.example', path: '/collections/crm' },
      ],
    });
    expect(request.system).toContain(
      '- Leave out product pages, product category, collection or range listings, store or brand home pages, and search or tag pages.',
    );
  });
});

describe('aggregateAngle', () => {
  const members = [
    url('https://globex.com/pricing', {
      classification: 'competitor',
      matchedCompetitor: 'Globex',
      sourceClass: 'competitor_owned',
      citations: [
        { id: 'c1', promptId: 'p1', engine: 'chatgpt' },
        { id: 'c2', promptId: 'p2', engine: 'gemini' },
      ],
    }),
    url('https://globex.com/compare', {
      classification: 'competitor',
      matchedCompetitor: 'Globex',
      citations: [{ id: 'c3', promptId: 'p1', engine: 'chatgpt' }],
    }),
    url('https://news.example/best-crm', {
      citations: [{ id: 'c4', promptId: 'p3', engine: 'perplexity' }],
    }),
  ];
  const owned = [
    {
      canonicalUrl: 'https://acme.test/pricing',
      citations: [
        { id: 'o1', promptId: 'p9', engine: 'chatgpt' },
        { id: 'o2', promptId: 'p2', engine: 'chatgpt' },
      ],
    },
  ];

  it('counts citations, domains, competitors, prompts and engines from the members', () => {
    expect(aggregateAngle({ members }, null, owned)).toEqual({
      citationCount: 4,
      domainCount: 2,
      competitorCount: 1,
      promptIds: ['p1', 'p2', 'p3'],
      engines: ['chatgpt', 'gemini', 'perplexity'],
      ownedCited: false,
      ownedCitationIds: [],
    });
  });

  it('is covered only when the matched page was cited for one of its prompts', () => {
    expect(aggregateAngle({ members }, 'https://acme.test/pricing', owned)).toMatchObject({
      ownedCited: true,
      ownedCitationIds: ['o2'],
    });
    const otherPrompt = [{ ...owned[0]!, citations: [owned[0]!.citations[0]!] }];
    expect(aggregateAngle({ members }, 'https://acme.test/pricing', otherPrompt)).toMatchObject({
      ownedCited: false,
      ownedCitationIds: [],
    });
  });
});

describe('validateAngles', () => {
  const input = { memberIds: ['u1', 'u2', 'u3'], maxLabelChars: 20 };

  it('admits angles as given, a left-out page included', () => {
    expect(
      validateAngles(
        { angles: [{ label: ' Pricing comparison ', member_ids: ['u1', 'u3'] }] },
        input,
      ),
    ).toEqual({ ok: true, value: [{ label: 'Pricing comparison', memberIds: ['u1', 'u3'] }] });
  });

  it.each([
    [[{ label: 'A', member_ids: ['u4'] }], 'unknown_member'],
    [
      [
        { label: 'A', member_ids: ['u1'] },
        { label: 'B', member_ids: ['u1', 'u2'] },
      ],
      'duplicate_member',
    ],
    [[{ label: 'A', member_ids: [] }], 'empty_angle'],
    [[{ label: 'A label well over twenty characters', member_ids: ['u1'] }], 'label_length'],
    [[{ label: '  ', member_ids: ['u1'] }], 'label_length'],
  ])('rejects %j as %s, repairing nothing', (angles, reason) => {
    expect(validateAngles({ angles }, input)).toEqual({ ok: false, reason });
  });
});

describe('validateMatches', () => {
  const input = {
    angles: [
      { id: 'a1', candidateIds: ['p1', 'p2'] },
      { id: 'a2', candidateIds: [] },
    ],
  };

  it("admits a pick among the angle's candidates and an explicit none", () => {
    const result = validateMatches(
      {
        matches: [
          { angle_id: 'a1', owned_page_id: 'p2' },
          { angle_id: 'a2', owned_page_id: null },
        ],
      },
      input,
    );
    expect(result.ok && Object.fromEntries(result.value)).toEqual({ a1: 'p2', a2: null });
  });

  it.each([
    [[{ angle_id: 'a3', owned_page_id: null }], 'unknown_angle'],
    [
      [
        { angle_id: 'a1', owned_page_id: null },
        { angle_id: 'a1', owned_page_id: 'p1' },
      ],
      'duplicate_angle',
    ],
    [[{ angle_id: 'a1', owned_page_id: 'p1' }], 'missing_angle'],
    [
      [
        { angle_id: 'a1', owned_page_id: null },
        { angle_id: 'a2', owned_page_id: 'p1' },
      ],
      'unknown_owned_page',
    ],
  ])('rejects %j as %s', (matches, reason) => {
    expect(validateMatches({ matches }, input)).toEqual({ ok: false, reason });
  });
});
