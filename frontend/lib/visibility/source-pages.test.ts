import { describe, expect, it } from 'vite-plus/test';

import { absenceBasis, presenceLabel, standingLabel } from './source-pages';

describe('cited-page vocabulary', () => {
  it('never renders an unread page as an absence', () => {
    expect(presenceLabel('not_inspected')).toBe('Not inspected');
    expect(presenceLabel('not_detected')).toBe('Not found on the page');
  });

  it('says a name too short to judge was not judged, never that it is absent', () => {
    expect(presenceLabel('not_assessable')).toBe('Name too short to judge on a page');
    expect(standingLabel('not_assessable')).toBe('Not assessable');
    expect(absenceBasis('not_assessable', 'none', 4200)).toBeNull();
  });

  it('drops a token it has no words for rather than leaking it', () => {
    expect(presenceLabel('invented_state')).toBeNull();
  });

  it('qualifies an absence with the method and the coverage behind it', () => {
    expect(absenceBasis('not_detected', 'exact_alias', 4200)).toBe(
      'Searched 4,200 characters of readable text for the exact name.',
    );
  });

  it('says outright that nothing matched, rather than naming a null method', () => {
    expect(absenceBasis('not_detected', 'none', 4200)).toBe(
      'Searched 4,200 characters of readable text; no form of the name matched.',
    );
  });

  it('never tells an ambiguous or partial verdict that nothing matched', () => {
    expect(absenceBasis('ambiguous', null, 4200)).toContain('could not be quoted');
    expect(absenceBasis('partial', null, 4200)).toContain('not enough of it');
    expect(absenceBasis('not_detected', null, 4200)).toContain('no form of the name matched');
  });

  it('offers no basis for a positive finding, which has its own passage', () => {
    expect(absenceBasis('present', 'exact_alias', 4200)).toBeNull();
  });

  it('offers no basis for a page nobody read or whose read text is unknown', () => {
    expect(absenceBasis('not_detected', null, 0)).toBeNull();
    expect(absenceBasis('not_detected', null, null)).toBeNull();
  });
});
