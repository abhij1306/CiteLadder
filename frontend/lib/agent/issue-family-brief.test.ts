import { describe, expect, it } from 'vite-plus/test';
import type { SiteIssueDetail } from '@citeladder/contracts';

import { occurrence } from '@/components/site-health/issues-catalog.test-support';
import { issueFamilyBrief } from './issue-family-brief';

const RULE = 'web.mobile_viewport';
const FIX = 'Add a responsive viewport meta declaration.';

const cohort = (pageCount: number, crawled: number | null = 412) => ({
  rule_id: RULE,
  rule_label: 'Mobile viewport missing',
  crawl_id: '44444444-4444-4444-8444-444444444444',
  group_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  page_count: pageCount,
  whole_site: false,
  crawl_completed_at: null,
  crawl_analyzed_url_count: crawled,
});

function onPage(index: number, rule = RULE) {
  return occurrence({
    rule_id: rule,
    occurrence_id: `dddddddd-${String(index).padStart(4, '0')}-4111-8111-111111111111`,
    site_url_id: `cccccccc-${String(index).padStart(4, '0')}-4111-8111-111111111111`,
    normalized_url: `https://acme.com/page-${index}`,
    evidence: {},
  });
}

function detail(occurrences: SiteIssueDetail['occurrences']): SiteIssueDetail {
  return {
    group_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    crawl_id: '44444444-4444-4444-8444-444444444444',
    rule_id: RULE,
    dimension: 'technical',
    category: 'mobile',
    severity: 'high',
    title: 'Mobile viewport missing',
    description: 'The document declares a mobile viewport.',
    remediation: FIX,
    remediation_route: 'code',
    occurrences,
    occurrence_count: occurrences.length,
    affected_url_count: occurrences.length,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-11-14T00:00:00Z',
    next_cursor: null,
  };
}

describe('issueFamilyBrief', () => {
  it('claims one shared fix only for the pages whose evidence shows it', () => {
    const all = issueFamilyBrief({
      cohort: cohort(3),
      grouping: 'seo',
      fix: FIX,
      issue: detail([onPage(1), onPage(2), onPage(3)]),
    });
    expect(all).toEqual({
      overview:
        'Mobile viewport missing on 3 URLs. All 3 show the same <meta name="viewport">, so one fix where it is defined clears them together.',
      why: 'Search engines and AI crawlers check this before they index, rank or cite a page. 3 of your 412 crawled URLs carry it.',
      steps: [
        FIX,
        'Start with <meta name="viewport">: 3 pages share it',
        'Ship the change; the next crawl re-checks all 3 URLs',
      ],
    });

    const some = issueFamilyBrief({
      cohort: cohort(40),
      grouping: 'seo',
      fix: FIX,
      issue: detail([onPage(1), onPage(2)]),
    });
    expect(some.overview).toBe(
      'Mobile viewport missing on 40 URLs. 2 of the 2 pages checked show the same <meta name="viewport">, so one fix where it is defined clears them together.',
    );
  });

  it('states the scope and the catalog fix alone before the Issues group loads', () => {
    expect(
      issueFamilyBrief({ cohort: cohort(1, null), grouping: 'aeo', fix: FIX, issue: undefined }),
    ).toEqual({
      overview: 'Mobile viewport missing on 1 URL.',
      why: 'AI answer engines and agents read this to understand, trust and cite your pages. It shows on 1 URL in this crawl.',
      steps: [FIX, 'Ship the change; the next crawl re-checks it'],
    });
  });
});
