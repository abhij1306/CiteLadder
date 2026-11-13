/** Site Health defects become one page finding per opportunity rule, keeping every rule (SH-B2). */
import { describe, expect, it } from 'vitest';

import { detectSiteIssueOpportunities } from '../src/analysis/opportunities/detectors.ts';

const PAGE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const defect = (issue_id: string, rule_id: string, site_url_id = PAGE) => ({
  issue_id,
  rule_id,
  severity: 'low',
  category: 'content',
  site_url_id,
  evidence: { observed: rule_id },
  finding_class: 'defect',
});

const stored = (issue_id: string, rule_id: string) => ({
  issue_id,
  rule_id,
  severity: 'low',
  category: 'content',
  evidence: { observed: rule_id },
});

describe('page findings from Site Health defects', () => {
  it('folds every defect a page has under one rule into one finding that names each', () => {
    const hits = detectSiteIssueOpportunities({
      crawl_id: 'crawl-1',
      truncated: false,
      issues: [
        defect('issue-b', 'aeo.question_headings'),
        defect('issue-a', 'aeo.answer_first'),
        defect('issue-c', 'aeo.answer_first', OTHER),
      ],
      urls: [
        { site_url_id: PAGE, normalized_url: 'https://acme.test/a' },
        { site_url_id: OTHER, normalized_url: 'https://acme.test/b' },
      ],
      families: [],
      coverage: {},
      limitations: [],
    });
    expect(hits.map((hit) => [hit.rule_id, hit.source_issue_ids, hit.evidence])).toEqual([
      [
        'content_structure_incomplete',
        ['issue-a', 'issue-b'],
        {
          issues: [
            stored('issue-a', 'aeo.answer_first'),
            stored('issue-b', 'aeo.question_headings'),
          ],
          crawl_id: 'crawl-1',
          site_url_id: PAGE,
          url: 'https://acme.test/a',
          coverage: {},
          limitations: [],
        },
      ],
      [
        'content_structure_incomplete',
        ['issue-c'],
        {
          issues: [stored('issue-c', 'aeo.answer_first')],
          crawl_id: 'crawl-1',
          site_url_id: OTHER,
          url: 'https://acme.test/b',
          coverage: {},
          limitations: [],
        },
      ],
    ]);
  });
});
