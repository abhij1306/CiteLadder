import { describe, expect, it } from 'vite-plus/test';

import type { Visibility } from '@/lib/api/types';
import { coverageSummary } from './coverage';

const date = (iso: string) => `D(${iso.slice(0, 10)})`;
function selected(patch: Record<string, unknown> = {}): Visibility {
  return {
    selection_mode: 'run',
    per_engine: [{}, {}],
    counts: { state: 'observed', responses: 8, expected: 10, failed: 0, not_run: 0 },
    comparison: null,
    ...patch,
  } as unknown as Visibility;
}
const counts = (patch: Record<string, unknown>) =>
  selected({
    counts: { state: 'observed', responses: 8, expected: 10, failed: 0, not_run: 0, ...patch },
  });
const comparison = (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  selected({ comparison: { baseline_at: '2026-03-01T00:00:00Z', ...patch }, ...extra });

describe('coverageSummary answers', () => {
  it('keeps missing counts, no observations and all-failed answers distinct', () => {
    const missing = coverageSummary(selected({ counts: null }), date).answers;
    const none = coverageSummary(counts({ state: 'no_observations', responses: 0 }), date).answers;
    const failed = coverageSummary(counts({ responses: 0, failed: 4, not_run: 1 }), date).answers;
    expect(none).toMatch(/no answers/i);
    expect(missing).not.toBe(none);
    expect(failed).toMatch(/4 failed/);
    expect(failed).toMatch(/1 not run/);
  });

  it('states the denominator only when the expected count is known', () => {
    const known = coverageSummary(selected(), date).answers;
    expect(known).toContain('8');
    expect(known).toContain('10');
    const unknown = coverageSummary(counts({ expected: null }), date).answers;
    expect(unknown).toContain('8');
    expect(unknown).not.toContain('10');
  });

  it('reports failed and not-run answers separately and omits zero parts', () => {
    const both = coverageSummary(counts({ failed: 3, not_run: 2 }), date).answers;
    expect(both).toMatch(/3 failed/);
    expect(both).toMatch(/2 not run/);
    const clean = coverageSummary(selected(), date).answers;
    expect(clean).not.toMatch(/failed|not run/);
  });
});

describe('coverageSummary change line', () => {
  it('names the baseline date for a comparable run, and a period in range mode', () => {
    const run = coverageSummary(comparison({ status: 'comparable' }), date).change;
    expect(run).toContain('D(2026-03-01)');
    const range = coverageSummary(
      comparison({ status: 'comparable' }, { selection_mode: 'range' }),
      date,
    ).change;
    expect(range).toContain('D(2026-03-01)');
    expect(range).not.toBe(run);
  });

  it('says a matched subset compares only the shared answers', () => {
    const line = coverageSummary(
      comparison({ status: 'matched_subset', current_counts: { responses: 6 } }),
      date,
    ).change;
    expect(line).toContain('6');
    expect(line).toContain('D(2026-03-01)');
  });

  it('explains a missing change with the number of skipped runs', () => {
    const skipped = coverageSummary(
      selected({ comparison: { status: 'no_comparison', skipped_runs: 4 } }),
      date,
    ).change;
    expect(skipped).toContain('4');
    const none = coverageSummary(selected(), date).change;
    expect(none).not.toContain('4');
    expect(none).toMatch(/no change/i);
  });
});
