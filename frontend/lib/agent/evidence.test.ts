import { describe, expect, it } from 'vite-plus/test';

import { groupEvidence } from './evidence';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('groupEvidence', () => {
  it('links one record to its own page and several to their screen', () => {
    expect(groupEvidence([`citeladder://action/${A}`])).toEqual([
      { label: 'Action', count: 1, href: `/agent/actions/${A}` },
    ]);
    expect(groupEvidence([`citeladder://action/${A}`, `citeladder://action/${B}`])).toEqual([
      { label: 'Action', count: 2, href: '/agent/actions' },
    ]);
  });

  it('counts repeated references once and never links an unknown kind', () => {
    expect(
      groupEvidence([
        `citeladder://site_page/${A}`,
        `citeladder://site_page/${A}`,
        `citeladder://mystery/${B}`,
      ]),
    ).toEqual([
      { label: 'Site page', count: 1, href: '/site' },
      { label: 'CiteLadder record', count: 1, href: null },
    ]);
  });
});
