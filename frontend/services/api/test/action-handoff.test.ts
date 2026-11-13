/**
 * The message an Action's Agent chat opens with (AS3): each approach branch's
 * template, filled from the Action's own evidence, with a plainer sentence
 * when a fact is missing. Pure: grouping runs on members, nothing is stored.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  groupMembers,
  NO_HANDOFF_FACTS,
  readHandoff,
  type ActionMember,
  type HandoffFacts,
} from '../src/analysis/opportunities/actions.ts';
import type { TargetRef } from '../src/analysis/opportunities/targets.ts';
import { actionMember } from '../src/opportunities/action-sync.ts';
import { newOpportunity } from '../src/opportunities/refresh-compute.ts';

const SITE = 'https://acme.test';

function member(
  rule_id: string,
  title: string,
  target: TargetRef,
  extra: Partial<{ label_hint: string; facts: HandoffFacts }> = {},
): ActionMember {
  return {
    opportunity_id: randomUUID(),
    rule_id,
    target,
    label_hint: extra.label_hint ?? null,
    measured_by: null,
    title,
    priority_score: 10,
    source_analysis_ids: [],
    source_issue_ids: [],
    source_metric_ids: [],
    facts: extra.facts ?? NO_HANDOFF_FACTS,
  };
}

/** The one Action the members group into, as its handoff. */
function handoffOf(...members: ActionMember[]) {
  const [group, ...rest] = groupMembers(members);
  if (!group || rest.length) throw new Error('Expected the members to form one Action');
  return group.diagnosis.handoff;
}

const page = (path: string): TargetRef => ({ kind: 'site_page', url: `${SITE}${path}` });

describe('Action handoff message', () => {
  it('asks for a listing alongside the competitors read on the earned page', () => {
    const target: TargetRef = {
      kind: 'earned_page',
      url_hash: 'abc',
      url: 'https://review.example/best',
      theme: null,
    };
    const listed = { competitors: ['Globex', 'Initech'], angle: null };
    expect(
      handoffOf(member('earned_page_acquire_listing', 'Get listed', target, { facts: listed })),
    ).toEqual({
      context: 'action',
      message:
        'Draft a request to be listed on https://review.example/best, alongside Globex and Initech.',
    });
    expect(handoffOf(member('earned_page_acquire_listing', 'Get listed', target)).message).toBe(
      'Draft a request to be listed on https://review.example/best.',
    );
  });

  it('reads the competitors from the earned finding as the refresh stores it', () => {
    const target: TargetRef = {
      kind: 'earned_page',
      url_hash: 'abc',
      url: 'https://review.example/best',
      theme: null,
    };
    const row = newOpportunity(
      {
        rule_id: 'earned_page_acquire_listing',
        target,
        evidence: {
          content_handoff: {
            url_hash: 'abc',
            affected_prompts: [],
            observed_competitors: ['Globex', 'Initech', 'Umbrella'],
          },
          priority_factors: { page_recurrence_factor: 1, page_competitor_presence_factor: 1 },
        },
        source_analysis_ids: [],
        source_issue_ids: [],
        source_metric_ids: [],
        value_factor: 1,
        gap_factor: 1,
      },
      40,
    );
    expect(handoffOf(actionMember({ ...row, id: randomUUID(), target })).message).toBe(
      'Draft a request to be listed on https://review.example/best, alongside Globex, Initech, and Umbrella.',
    );
  });

  it('names the Site Health issue of a technical fix', () => {
    expect(
      handoffOf(
        member('missing_structured_data', 'Missing structured data on owned page', page('/a')),
      ).message,
    ).toBe('Fix "Missing structured data on owned page" on https://acme.test/a.');
  });

  it('names the angle of a content gap, and hands the page to its workflow', () => {
    const gap = { competitors: [], angle: 'Pricing comparison' };
    expect(
      handoffOf(
        member('content_gap_improve_page', 'Content gap', page('/crm-pricing'), { facts: gap }),
      ),
    ).toEqual({
      context: 'page_url',
      workflow_id: 'optimize_page',
      message:
        'Improve https://acme.test/crm-pricing so AI answers cite it for Pricing comparison.',
    });
    const planned = member(
      'content_gap_new_page',
      'Content gap',
      { kind: 'planned_page', key: 'planned:setup-guide', label: 'Setup guide' },
      { facts: { competitors: [], angle: 'Setup guides for small teams' } },
    );
    expect(handoffOf(planned)).toEqual({
      context: 'opportunity',
      workflow_id: 'article',
      opportunity_id: planned.opportunity_id,
      message: 'Write a page about Setup guides for small teams for the prompts in this Action.',
    });
  });

  it('writes the message for the finding the handoff attaches when a planned page has a search gap too', () => {
    const search = {
      ...member('search_keyword_gap', 'Competitors rank for a search you do not', {
        kind: 'search_gap',
        terms: 'guide setup',
        keyword: 'Setup guide',
        url: null,
      }),
      priority_score: 30,
    };
    const gap = member(
      'content_gap_new_page',
      'Content gap',
      { kind: 'planned_page', key: 'planned:setup-guide', label: 'Setup guide' },
      { facts: { competitors: [], angle: 'Setup guides for small teams' } },
    );
    expect(handoffOf(search, gap)).toEqual({
      context: 'opportunity',
      workflow_id: 'article',
      opportunity_id: gap.opportunity_id,
      message: 'Write a page about Setup guides for small teams for the prompts in this Action.',
    });
  });

  it('writes a crawled URL that carries two encoding layers as a reader reads it', () => {
    const crawled = page('/Categories/Women/Women%2527s-Clothing/Womens-Maxi-Dress');
    expect(
      handoffOf(member('missing_structured_data', 'Missing structured data', crawled)).message,
    ).toBe(
      'Fix "Missing structured data" on https://acme.test/Categories/Women/Women\'s-Clothing/Womens-Maxi-Dress.',
    );
    // An Action read without a persisted handoff opens about its label the same way.
    expect(
      readHandoff(null, 'https://www.bestandless.com.au/Categories/Women/Women%2527s-Clothing'),
    ).toEqual({
      context: 'action',
      message: "Work on https://www.bestandless.com.au/Categories/Women/Women's-Clothing.",
    });
  });

  it('never ends a message in two full stops when the label ends a sentence', () => {
    expect(
      readHandoff(null, 'Compare affordable kids underwear for back-to-school shopping.').message,
    ).toBe('Work on Compare affordable kids underwear for back-to-school shopping.');
    expect(readHandoff(null, 'Which CRM is cheapest?').message).toBe(
      'Work on Which CRM is cheapest?',
    );
    expect(readHandoff(null, '100% cotton tees').message).toBe('Work on 100% cotton tees.');
  });

  it('falls back to the Action label when a content gap has no angle', () => {
    expect(
      handoffOf(member('content_gap_improve_page', 'Content gap', page('/crm-pricing'))).message,
    ).toBe(
      'Improve https://acme.test/crm-pricing so AI answers cite it for the prompts in this Action.',
    );
  });

  it('fills each remaining branch from the Action label and its strongest finding', () => {
    const prompt: TargetRef = { kind: 'prompt', prompt_id: randomUUID(), theme: null };
    const cases: [ActionMember, string][] = [
      [
        member(
          'query_cannibalization',
          'Multiple pages compete for one query',
          { kind: 'demand', identity_hash: 'h', url: null, query: 'crm pricing' },
          { label_hint: 'crm pricing' },
        ),
        'Merge or differentiate the pages that compete for crm pricing.',
      ],
      [
        member('brand_absent_high_value_prompt', 'Brand absent', prompt, {
          label_hint: 'best crm for small teams',
        }),
        'Write a page that answers the prompt "best crm for small teams".',
      ],
      [
        member('search_keyword_gap', 'Competitors rank for a search you do not', {
          kind: 'search_gap',
          terms: 'socks trail',
          keyword: 'Trail Socks',
          url: null,
        }),
        'Write a page for the search "Trail Socks".',
      ],
      [
        member(
          'site_link_near_orphan',
          'Indexable page has too few followed internal links',
          page('/b'),
        ),
        'Fix "Indexable page has too few followed internal links" on https://acme.test/b with internal links.',
      ],
      [
        member('striking_distance_query', 'Query is within striking distance', page('/c')),
        'Improve https://acme.test/c for its search demand: "Query is within striking distance".',
      ],
      [
        member('owned_page_not_cited', 'Owned page not cited for target prompt', prompt, {
          label_hint: 'best crm',
        }),
        'Work on best crm: "Owned page not cited for target prompt".',
      ],
    ];
    expect(cases.map(([one]) => handoffOf(one))).toEqual(
      cases.map(([, message]) => ({ context: 'action', message })),
    );
  });
});
