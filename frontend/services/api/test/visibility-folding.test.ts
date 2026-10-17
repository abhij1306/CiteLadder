/**
 * The pure decisions behind folded visibility trends: UTC bucket
 * boundaries, share of voice across a renamed brand, and a rate a run never
 * recorded, which is absent rather than zero.
 */
import { describe, expect, it } from 'vitest';

import { mentionSov } from '../src/visibility/metrics.ts';
import type { TrendSource } from '../src/visibility/runs.ts';
import { bucketStart, foldBucket } from '../src/visibility/trend-folding.ts';

function source(metrics: Record<string, unknown>, completed: number): TrendSource {
  return {
    snapshotId: crypto.randomUUID(),
    auditId: crypto.randomUUID(),
    completedAt: '2026-03-02T09:00:00.000000',
    logicalEngine: null,
    transportModel: 'model-a',
    retrievalEnabled: true,
    modelProvenance: [],
    analyzerVersion: 'v1',
    scoringRuleVersion: 'v1',
    totalCompleted: completed,
    visibilityScore: null,
    metrics: { total_completed: completed, ...metrics },
    comparisonKey: 'key',
    promptPerformanceScore: null,
  };
}

describe('bucketStart', () => {
  it('starts weeks on the ISO Monday, across a month and a year', () => {
    expect(bucketStart('2026-03-01T23:59:59.999999', 'week')).toBe('2026-02-23T00:00:00.000000');
    expect(bucketStart('2026-03-02T00:00:00.000000', 'week')).toBe('2026-03-02T00:00:00.000000');
    expect(bucketStart('2027-01-01T12:00:00.000000', 'week')).toBe('2026-12-28T00:00:00.000000');
    expect(bucketStart('2026-03-31T12:00:00.000000', 'month')).toBe('2026-03-01T00:00:00.000000');
  });
});

describe('mentionSov', () => {
  it('sums every brand key a bucket saw, so a rename does not undercount', () => {
    const counts = { Acme: 3, 'Acme Corp': 2, Rival: 5 };
    expect(mentionSov(counts, new Set(['Acme', 'Acme Corp']))).toBe(0.5);
    expect(mentionSov({ Acme: 0 }, new Set(['Acme']))).toBeNull();
  });
});

describe('foldBucket', () => {
  it('weights rates by responses and never dilutes one a run did not record', () => {
    const recorded = source({ owned_citation_rate: 0.5, brand_mention_rate: 1 }, 4);
    const unrecorded = source({ brand_mention_rate: 0 }, 4);

    const point = foldBucket('2026-03-02T00:00:00.000000', [recorded, unrecorded]);

    expect(point.visibility_rate).toBe(0.5);
    // Only the run that recorded an owned rate contributes to it.
    expect(point.owned_citation_rate).toBe(0.5);
    expect(point.completed_at).toBe('2026-03-02T00:00:00Z');
  });
});
