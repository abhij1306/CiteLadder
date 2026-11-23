import { describe, expect, it } from 'vite-plus/test';

import { standingLabel } from '@citeladder/contracts/page-labels';

import { presenceLabel, quoteParts, readableQuote } from './source-pages';

describe('cited-page vocabulary', () => {
  it('never renders an unread page as an absence', () => {
    expect(presenceLabel('not_inspected')).toBe('Not inspected');
    expect(presenceLabel('not_detected')).toBe('Not found on the page');
  });

  it('says a name too short to judge was not judged, never that it is absent', () => {
    expect(presenceLabel('not_assessable')).toBe('Name too short to judge on a page');
    expect(standingLabel('not_assessable')).toBe('Not assessable');
  });

  it('drops a token it has no words for rather than leaking it', () => {
    expect(presenceLabel('invented_state')).toBeNull();
  });
});

describe('page quotes', () => {
  it.each([
    ['Kmart has the cheapest full kit, Targ', 'Kmart has the cheapest full kit…'],
    [
      'lworths Group) targets the same value tier as Kmart, which k',
      '…Group) targets the same value tier as Kmart, which…',
    ],
    ['Target better uniform fabric.', 'Target better uniform fabric.'],
    ['  Big W   leads\nthe list.  ', 'Big W leads the list.'],
  ])('cuts %j only at word boundaries', (passage, expected) => {
    expect(readableQuote(passage)).toBe(expected);
  });

  it('finds the name in any letter case and keeps the text as written', () => {
    expect(quoteParts('Kmart vs BIG W prices', 'Big W')).toEqual({
      before: 'Kmart vs ',
      match: 'BIG W',
      after: ' prices',
    });
    expect(quoteParts('No rival here', 'Big W')).toEqual({
      before: 'No rival here',
      match: '',
      after: '',
    });
  });
});
