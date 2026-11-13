/**
 * Opportunity decisions the seeded PostgreSQL scenario never reaches: earned
 * page selection and scoring, the Actions list's groups and priority bands,
 * which site changes promote to a rule, how a
 * confirmed decline ranks, and how verification folds per-check readings.
 */
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { siteHealth } from '../src/config/site-health.ts';
import type { SourcePageEvidence } from '../src/analysis/opportunities/evidence.ts';
import { detectEarnedPageOpportunities } from '../src/analysis/opportunities/earned-pages.ts';
import { actionGroup, priorityBand } from '../src/analysis/opportunities/actions.ts';
import { changeRule } from '../src/opportunities/refresh-hits.ts';
import { declineGap, declineValue } from '../src/opportunities/refresh-evidence.ts';
import { priorityScore } from '../src/analysis/opportunities/scoring.ts';
import {
  mergeOutcomes,
  observationKind,
  type CheckOutcome,
} from '../src/opportunities/verification-decisions.ts';

const r = siteHealth.change_intel;

const entity = (kind: string, name: string, presence: string, matches = 1) => ({
  entity_kind: kind,
  entity_name: name,
  presence,
  match_method: 'alias',
  match_count: matches,
  passages: [],
});

function page(overrides: Partial<SourcePageEvidence> = {}): SourcePageEvidence {
  return {
    url_hash: 'hash-a',
    canonical_url: 'https://review.example/best-crm',
    registrable_domain: 'review.example',
    page_format: 'listicle',
    page_format_method: 'heading_evidence',
    source_class: 'editorial_third_party',
    snapshot_id: 'snapshot-2',
    read_at: '2026-10-01T00:00:00Z',
    extracted_chars: 4000,
    title: 'Best CRM tools',
    entities: [
      entity('brand', 'Acme', 'not_detected', 0),
      entity('competitor', 'Rival One', 'present'),
      entity('competitor', 'Rival Two', 'present'),
    ],
    recurrence_count: 3,
    answer_count: 3,
    prompts: [{ prompt_id: 'prompt-1', text: 'best crm for startups' }],
    themes: ['crm'],
    analysis_ids: ['analysis-1'],
    answer_competitors: [],
    ...overrides,
  };
}

const detect = (pages: SourcePageEvidence[]) =>
  detectEarnedPageOpportunities({
    pages,
    eligible_answers: 6,
    inspected_pages: pages.length,
    total_pages: pages.length,
  });

describe('earned page opportunities', () => {
  it('asks to get listed where competitors are and the brand is not, measured on its prompts', () => {
    const [hit] = detect([page()]);
    expect(hit).toMatchObject({
      rule_id: 'earned_page_acquire_listing',
      target: { kind: 'earned_page', url_hash: 'hash-a' },
      source_analysis_ids: ['analysis-1'],
      value_factor: 1.5,
      gap_factor: 1.4,
      evidence: {
        content_handoff: {
          affected_prompts: [{ prompt_id: 'prompt-1', text: 'best crm for startups' }],
          observed_competitors: ['Rival One', 'Rival Two'],
          ask: 'Be included on this page alongside Rival One, Rival Two, with an entry comparable to theirs that links to your site.',
        },
      },
    });
  });

  it('acts on every Gap page, whatever its format and however rarely it is cited', () => {
    // An article cited by one answer, read thinly: still a Gap, so still an Action.
    const once = page({
      page_format: 'article',
      recurrence_count: 1,
      answer_count: 1,
      extracted_chars: 200,
    });
    const [hit] = detect([once]);
    expect(hit).toMatchObject({
      rule_id: 'earned_page_acquire_listing',
      target: { kind: 'earned_page', url_hash: 'hash-a' },
      value_factor: 7 / 6,
      gap_factor: 1.4,
    });
    // It ranks below the same page cited by three answers.
    expect(hit!.value_factor).toBeLessThan(detect([page()])[0]!.value_factor);
  });

  it("never asks to be listed on a competitor's own page", () => {
    expect(detect([page({ source_class: 'competitor_owned' })])).toEqual([]);
    expect(detect([page({ source_class: 'other_third_party' })])).toHaveLength(1);
  });

  it('needs the brand confirmed absent, not merely unmatched or present', () => {
    const brand = (presence: string) => ({
      entities: [entity('brand', 'Acme', presence), entity('competitor', 'Rival One', 'present')],
    });
    expect(detect([page(brand('present'))])).toEqual([]);
    expect(detect([page(brand('ambiguous'))])).toEqual([]);
    expect(detect([page(brand('not_detected'))])).toHaveLength(1);
  });

  it('judges a page on its last successful reading', () => {
    expect(detect([page({ snapshot_id: null })])).toEqual([]);
  });
});

describe('Actions list groups', () => {
  const a = policy.opportunity.actions;
  // Off product and category targets, the approach decides the group.
  const BY_APPROACH: Record<string, string> = {
    earned_placement: 'earned',
    fix_technical: 'fix_site',
    improve_links: 'fix_site',
    create_new: 'own_pages',
    improve_existing: 'own_pages',
    consolidate: 'own_pages',
    // An Agent-origin Action before any diagnosis.
    '': 'own_pages',
  };

  it('names a group for every approach the tree can store', () => {
    const stored = new Set([
      ...a.APPROACH_TREE.map((b) => b.approach),
      a.DEFAULT_APPROACH.approach,
    ]);
    expect([...stored].sort()).toEqual(Object.keys(BY_APPROACH).filter(Boolean).sort());
  });

  it('puts every Action in exactly one group: products by target, the rest by approach', () => {
    for (const approach of Object.keys(BY_APPROACH))
      for (const target_kind of a.ACTION_TARGET_KINDS)
        expect([approach, target_kind, actionGroup({ approach, target_kind })]).toEqual([
          approach,
          target_kind,
          ['product', 'category'].includes(target_kind) ? 'products' : BY_APPROACH[approach],
        ]);
  });

  it('bands a priority score at 30 and 20; an unscored Action has no band', () => {
    expect([40, 30, 29.9, 20, 19.9, 0, null].map(priorityBand)).toEqual([
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
      null,
    ]);
  });
});

describe('site change promotion', () => {
  const content = (after: unknown) =>
    changeRule({ change_class: 'changed', field: r.change_field, after });

  it('promotes approved regressions by class', () => {
    expect(changeRule({ change_class: r.class_critical, field: 'title', after: null })).toBe(
      'site_change_critical_regression',
    );
  });

  it('reads metadata inconsistency only from a complete comparison', () => {
    const complete = { comparison_coverage: 'complete', metadata_consistency: 'inconsistent' };
    expect(content({ ...complete, content_change_classification: 'unchanged' })).toBe(
      'site_change_cosmetic_refresh',
    );
    expect(content({ ...complete, content_change_classification: 'minor_change' })).toBe(
      'site_change_metadata_inconsistency',
    );
    // A substantial rewrite stays in change history instead of becoming an action.
    expect(
      content({ ...complete, content_change_classification: 'substantial_change' }),
    ).toBeNull();
    expect(content({ ...complete, comparison_coverage: 'partial' })).toBeNull();
    expect(content(null)).toBeNull();
  });
});

describe('confirmed decline ranking', () => {
  const o = policy.opportunity.opportunities;
  const floor = policy.audits.analysis.prompt_decline_materiality_points;
  const score = (confidence: number, delta: number | null) =>
    priorityScore('high', declineValue(confidence), declineGap(delta));

  it('surfaces every decline the audit confirmed, however weak the agreement', () => {
    expect(score(0, -floor)).toBeGreaterThanOrEqual(o.MIN_PRIORITY_TO_SURFACE);
    expect(score(0.3, null)).toBeGreaterThanOrEqual(o.MIN_PRIORITY_TO_SURFACE);
  });

  it('ranks a larger, more agreed decline above a marginal one, up to the cap', () => {
    expect(score(0.9, -2 * floor)).toBeGreaterThan(score(0.4, -floor));
    expect(score(1, -100 * floor)).toBe(score(1, -o.CONFIRMED_DECLINE_GAP_CAP * floor));
  });
});

describe('verification folding', () => {
  const read = (
    state: CheckOutcome['state'],
    at: string,
    source_kind = 'site_crawl',
  ): CheckOutcome => ({
    state,
    reason: state === 'unavailable' ? 'page_not_analyzed' : null,
    observed_at: at,
    source_kind,
    source_id: `${source_kind}-${at}`,
  });
  const fold = (...readings: Map<number, CheckOutcome>[]) =>
    readings.reduce((merged, next) => mergeOutcomes(merged, next), new Map());

  it('never lets a reading that could not answer replace an answer', () => {
    const merged = fold(
      new Map([[0, read('met', '2026-10-01')]]),
      new Map([[0, read('unavailable', '2026-10-05')]]),
    );
    expect(merged.get(0)?.state).toBe('met');
  });

  it('keeps the newer answer whichever order the sources arrive in', () => {
    const older = new Map([[0, read('met', '2026-10-01')]]);
    const newer = new Map([[0, read('unmet', '2026-10-05')]]);
    expect(fold(older, newer).get(0)?.state).toBe('unmet');
    expect(fold(newer, older).get(0)?.state).toBe('unmet');
  });

  it('verifies only once every check has its own met reading', () => {
    const crawl = new Map([[0, read('met', '2026-10-01')]]);
    const traffic = new Map([[1, read('met', '2026-10-02', 'traffic_snapshot')]]);
    expect(observationKind(fold(crawl), 2)).toBe('observed');
    expect(observationKind(fold(crawl, traffic), 2)).toBe('verified');
    expect(observationKind(fold(crawl, new Map([[1, read('unmet', '2026-10-03')]])), 2)).toBe(
      'contradicted',
    );
  });
});
