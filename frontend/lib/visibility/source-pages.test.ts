import { describe, expect, it } from 'vite-plus/test';

import { absenceBasis, presenceLabel } from './source-pages';

/**
 * "Nobody looked" and "we looked and you are not there" are different
 * sentences. Every surface reading a cited page goes through these labels, so
 * this is where the two are kept apart.
 */
describe('cited-page vocabulary', () => {
  it('never renders an unread page as an absence', () => {
    expect(presenceLabel('not_inspected')).toBe('Not inspected');
    expect(presenceLabel('not_detected')).toBe('Not found on the page');
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
    // `ambiguous` means a match WAS found and could not be quoted; `partial`
    // means too little was read. One shared fallback lied to both.
    expect(absenceBasis('ambiguous', null, 4200)).toContain('could not be quoted');
    expect(absenceBasis('partial', null, 4200)).toContain('not enough of it');
    expect(absenceBasis('not_detected', null, 4200)).toContain('no form of the name matched');
  });

  it('offers no basis for a positive finding, which has its own passage', () => {
    expect(absenceBasis('present', 'exact_alias', 4200)).toBeNull();
  });

  it('offers no basis for a page nobody read, where nothing was searched', () => {
    expect(absenceBasis('not_detected', null, 0)).toBeNull();
  });
});
