import { describe, expect, it } from 'vitest';
import { cohortComposition } from '../src/site-health/cohort-composition.ts';

const previous = {
  about_contact: 5,
  category: 52,
  docs: 5,
  homepage: 1,
  how_to: 1,
  local: 2,
  other: 4,
  product: 123,
  service: 6,
};

describe('cohortComposition', () => {
  it('keeps one page of count drift comparable', () => {
    const result = cohortComposition({
      previous,
      current: { ...previous, category: 53 },
      shareShiftPoints: 10,
    });

    expect(result).toEqual({
      changed: false,
      composition: {
        added_page_kinds: [],
        removed_page_kinds: [],
        previous_page_count_by_kind: previous,
        current_page_count_by_kind: { ...previous, category: 53 },
      },
    });
  });

  it('marks a page kind joining or leaving the cohort as changed', () => {
    const { changed, composition } = cohortComposition({
      previous: { homepage: 1, article: 30, product: 100 },
      current: { homepage: 1, product: 100, service: 1 },
      shareShiftPoints: 10,
    });

    expect(changed).toBe(true);
    expect(composition.added_page_kinds).toEqual(['service']);
    expect(composition.removed_page_kinds).toEqual(['article']);
  });

  it('marks a share shift at the threshold as changed and just below it as comparable', () => {
    // product 50/100 → 60/100 is exactly 10 points; 59/100 is 9.
    const atThreshold = cohortComposition({
      previous: { category: 50, product: 50 },
      current: { category: 40, product: 60 },
      shareShiftPoints: 10,
    });
    const belowThreshold = cohortComposition({
      previous: { category: 50, product: 50 },
      current: { category: 41, product: 59 },
      shareShiftPoints: 10,
    });

    expect(atThreshold.changed).toBe(true);
    expect(belowThreshold.changed).toBe(false);
  });

  it('measures share of the cohort, not raw count growth', () => {
    // Every kind doubles: counts change, shares do not.
    const { changed } = cohortComposition({
      previous: { category: 20, product: 80 },
      current: { category: 40, product: 160 },
      shareShiftPoints: 10,
    });

    expect(changed).toBe(false);
  });
});
