/**
 * Opportunity decisions the seeded PostgreSQL scenario never reaches: earned
 * page selection and scoring, which site changes promote to a rule, how a
 * confirmed decline ranks, and how verification folds per-check readings.
 */
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import type { SourcePageEvidence } from '../src/analysis/opportunities/evidence.ts';
import { detectEarnedPageOpportunities } from '../src/analysis/opportunities/earned-pages.ts';
import { changeRule } from '../src/opportunities/refresh-hits.ts';
import { declineGap, declineValue } from '../src/opportunities/refresh-evidence.ts';
import { priorityScore } from '../src/analysis/opportunities/scoring.ts';
import {
  mergeOutcomes,
  observationKind,
  type CheckOutcome,
} from '../src/opportunities/verification-decisions.ts';

const r = policy.opportunity.refresh;

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
    sufficient_coverage: true,
    title: 'Best CRM tools',
    entities: [
      entity('brand', 'Acme', 'not_detected', 0),
      entity('competitor', 'Rival One', 'present'),
      entity('competitor', 'Rival Two', 'present'),
    ],
    roster_current: true,
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
      target_key: 'earned-page:hash-a',
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

  it('acts on directory profiles and alternatives pages too', () => {
    expect(detect([page({ page_format: 'profile' })])).toHaveLength(1);
    expect(detect([page({ page_format: 'alternative' })])).toHaveLength(1);
    expect(detect([page({ page_format: 'article' })])).toEqual([]);
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

  it('judges a page on its last successful reading under the current roster', () => {
    expect(detect([page({ snapshot_id: null })])).toEqual([]);
    expect(detect([page({ roster_current: false })])).toEqual([]);
    expect(detect([page({ sufficient_coverage: false })])).toEqual([]);
  });
});

describe('site change promotion', () => {
  const content = (after: unknown) =>
    changeRule({ change_class: 'changed', field: r.content_change_field, after });

  it('promotes approved regressions by class', () => {
    expect(changeRule({ change_class: r.change_class_critical, field: 'title', after: null })).toBe(
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
