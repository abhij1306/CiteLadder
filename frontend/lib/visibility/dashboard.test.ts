import { describe, expect, it } from 'vite-plus/test';

import type { Visibility } from '@/lib/api/types';
import {
  PLACEHOLDER,
  findActiveRun,
  formatRate,
  formatScore,
  isDashboardStatus,
  presentEngines,
  sortedRankings,
  toRunOptions,
  visibleEngines,
} from './dashboard';

const AUDIT_A = '11111111-1111-4111-8111-111111111111';
const AUDIT_B = '22222222-2222-4222-8222-222222222222';
const AUDIT_C = '33333333-3333-4333-8333-333333333333';

function makeVisibility(overrides: Partial<Visibility> = {}): Visibility {
  return {
    project_id: '44444444-4444-4444-8444-444444444444',
    audit_id: AUDIT_A,
    audit_status: 'completed',
    analyzer_version: 'v1',
    scoring_rule_version: 'v1',
    cohort: 'core',
    coverage: { completed: 6, requested: 6, rate: 1 },
    total_completed: 6,
    total_failed: 0,
    visibility_score: 66.7,
    model_provenance: [],
    rankings: [],
    per_engine: [],
    avg_position: null,
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

describe('visibility dashboard helpers', () => {
  it('keeps only dashboard-ready statuses, newest first', () => {
    const options = toRunOptions([
      {
        id: AUDIT_A,
        status: 'completed',
        completed_at: '2026-07-10T00:00:00Z',
        created_at: '2026-07-10T00:00:00Z',
      },
      { id: AUDIT_B, status: 'running', completed_at: null, created_at: '2026-07-12T00:00:00Z' },
      {
        id: AUDIT_C,
        status: 'partially_completed',
        completed_at: '2026-07-14T00:00:00Z',
        created_at: '2026-07-14T00:00:00Z',
      },
    ]);
    expect(options.map((o) => o.id)).toEqual([AUDIT_C, AUDIT_A]);
  });

  it('flags dashboard statuses', () => {
    expect(isDashboardStatus('completed')).toBe(true);
    expect(isDashboardStatus('partially_completed')).toBe(true);
    expect(isDashboardStatus('running')).toBe(false);
  });

  it('finds the newest non-terminal run as the active run', () => {
    expect(
      findActiveRun([
        {
          id: AUDIT_A,
          status: 'completed',
          created_at: '2026-07-10T00:00:00Z',
        },
        { id: AUDIT_B, status: 'running', created_at: '2026-07-12T00:00:00Z' },
        { id: AUDIT_C, status: 'queued', created_at: '2026-07-14T00:00:00Z' },
      ]),
    ).toEqual({ id: AUDIT_C, status: 'queued', createdAt: '2026-07-14T00:00:00Z' });
  });

  it('returns null when every run is terminal', () => {
    expect(
      findActiveRun([
        { id: AUDIT_A, status: 'completed', created_at: '2026-07-10T00:00:00Z' },
        { id: AUDIT_B, status: 'failed', created_at: '2026-07-12T00:00:00Z' },
        { id: AUDIT_C, status: 'cancelled', created_at: '2026-07-14T00:00:00Z' },
      ]),
    ).toBeNull();
    expect(findActiveRun([])).toBeNull();
  });

  it('formats rates and scores, falling back to the placeholder', () => {
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(null)).toBe(PLACEHOLDER);
    expect(formatScore(72.4)).toBe('72');
    expect(formatScore(null)).toBe(PLACEHOLDER);
  });

  it('orders engines by canonical order and applies the engine filter', () => {
    const visibility = makeVisibility({
      per_engine: [
        {
          logical_engine: 'claude',
          total_completed: 2,
          brand_mention_rate: 0.5,
          owned_citation_rate: null,
          search_use_rate: null,
          visibility_score: 50,
        },
        {
          logical_engine: 'chatgpt',
          total_completed: 2,
          brand_mention_rate: 0.8,
          owned_citation_rate: null,
          search_use_rate: null,
          visibility_score: 80,
        },
      ],
    });
    expect(visibleEngines(visibility, 'all').map((e) => e.logical_engine)).toEqual([
      'chatgpt',
      'claude',
    ]);
    expect(visibleEngines(visibility, 'claude').map((e) => e.logical_engine)).toEqual(['claude']);
    expect(presentEngines(visibility)).toEqual(['chatgpt', 'claude']);
  });

  it('sorts rankings by share-of-voice descending', () => {
    const rows = sortedRankings([
      {
        name: 'Comp',
        is_brand: false,
        mention_rate: 0.2,
        citation_rate: null,
        share_of_voice: 0.2,
        mention_count: 1,
        avg_position: null,
      },
      {
        name: 'Acme',
        is_brand: true,
        mention_rate: 0.6,
        citation_rate: null,
        share_of_voice: 0.6,
        mention_count: 3,
        avg_position: null,
      },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Acme', 'Comp']);
  });
});
