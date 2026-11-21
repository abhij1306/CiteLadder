import { describe, expect, it } from 'vite-plus/test';

import type { Visibility } from '@citeladder/contracts';
import { answerShortfall, selectionBasis } from './coverage';

const counts = (patch: Record<string, unknown>) =>
  ({
    counts: { state: 'observed', responses: 8, expected: 10, failed: 0, not_run: 0, ...patch },
  }) as unknown as Visibility;

describe('answerShortfall', () => {
  it('states failed and not-run answers against the expected count, and nothing when complete', () => {
    expect(answerShortfall(counts({ failed: 3, not_run: 2 }))).toBe(
      '8 of 10 answers · 3 failed · 2 not run',
    );
    expect(answerShortfall(counts({ expected: null, failed: 1 }))).toBe('8 answers · 1 failed');
    expect(answerShortfall(counts({ responses: 0, failed: 10 }))).toBe(
      '0 of 10 answers · 10 failed',
    );
    expect(answerShortfall(counts({}))).toBeNull();
    expect(answerShortfall({ counts: null } as unknown as Visibility)).toBeNull();
  });
});

describe('selectionBasis', () => {
  it('adds the shared-answer count only to a matched-subset change', () => {
    const subset = (status: string, failed = 0) =>
      ({
        ...counts({ failed }),
        comparison: { status, matched_cells: 6, current_cells: 9 },
      }) as unknown as Visibility;
    expect(selectionBasis(subset('matched_subset', 2))).toBe(
      '8 of 10 answers · 2 failed · 6 of 9 answers comparable',
    );
    expect(selectionBasis(subset('matched_subset'))).toBe('6 of 9 answers comparable');
    expect(selectionBasis(subset('comparable'))).toBeNull();
  });
});
