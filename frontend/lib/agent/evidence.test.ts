import { describe, expect, it } from 'vite-plus/test';

import { actionEvidence, citedActions, groupEvidence } from './evidence';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('groupEvidence', () => {
  it('links one record to its own page and several to their screen', () => {
    expect(groupEvidence([`citeladder://action/${A}`])).toEqual([
      { label: 'Action', count: 1, href: `/actions/${A}` },
    ]);
    expect(groupEvidence([`citeladder://action/${A}`, `citeladder://action/${B}`])).toEqual([
      { label: 'Action', count: 2, href: '/actions' },
    ]);
  });

  it('falls back to the screen when a page needs more than the id', () => {
    expect(
      groupEvidence([`citeladder://visibility_result/${A}`, `citeladder://audit/${B}`]),
    ).toEqual([
      { label: 'Visibility answer', count: 1, href: '/visibility' },
      { label: 'Visibility run', count: 1, href: `/runs/${B}` },
    ]);
  });

  it('links each kind to its current page', () => {
    const one = (kind: string) => groupEvidence([`citeladder://${kind}/${A}`])[0]?.href;
    expect(['project', 'prompt', 'site_issue', 'search_row', 'visibility_result'].map(one)).toEqual(
      ['/projects', `/prompts/${A}`, '/issues', '/search-intelligence?tab=overview', '/visibility'],
    );
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

describe('citedActions', () => {
  it('keeps the cited Actions the chat projects, once each in citation order', () => {
    const a = { id: A, target_label: 'Buyer guide' };
    const b = { id: B, target_label: 'Returns policy' };
    const foreign = '33333333-3333-4333-8333-333333333333';
    expect(
      citedActions(
        [
          `citeladder://action/${B}`,
          `citeladder://opportunity/${A}`,
          `citeladder://action/${A}`,
          `citeladder://action/${B}`,
          `citeladder://action/${foreign}`,
        ],
        [a, b],
      ),
    ).toEqual([b, a]);
  });
});

describe('actionEvidence', () => {
  it('dates each finding and each distinct check reading from the read', () => {
    expect(
      actionEvidence({
        members: [{ id: A, title: 'Images without alt text', updated_at: '2026-11-08T09:00:00Z' }],
        declaration: {
          checks: [
            { observed_at: '2026-11-10T00:00:00Z', source_kind: 'audit', source_id: A },
            { observed_at: '2026-11-09T00:00:00Z', source_kind: 'site_crawl', source_id: B },
            { observed_at: '2026-11-10T00:00:00Z', source_kind: 'site_crawl', source_id: B },
            { observed_at: null, source_kind: null, source_id: null },
            { observed_at: '2026-11-10T00:00:00Z', source_kind: 'mystery', source_id: B },
          ],
        },
      }),
    ).toEqual([
      {
        key: `opportunity/${A}`,
        label: 'Images without alt text',
        at: '2026-11-08T09:00:00Z',
        basis: 'inferred',
        href: null,
      },
      {
        key: `audit/${A}`,
        label: 'Visibility run',
        at: '2026-11-10T00:00:00Z',
        basis: 'observed',
        href: `/runs/${A}`,
      },
      {
        key: `site_crawl/${B}`,
        label: 'Site crawl',
        at: '2026-11-09T00:00:00Z',
        basis: 'observed',
        href: '/site',
      },
      {
        key: `mystery/${B}`,
        label: 'CiteLadder record',
        at: '2026-11-10T00:00:00Z',
        basis: 'observed',
        href: null,
      },
    ]);
  });
});
