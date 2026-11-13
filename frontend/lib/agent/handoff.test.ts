import { describe, expect, it } from 'vite-plus/test';

import {
  agentHandoff,
  agentHandoffHref,
  contextChips,
  developerTicket,
  parseAgentHandoff,
  withoutContext,
} from './handoff';

const ACTION = '11111111-1111-4111-8111-111111111111';
const DATASET = '22222222-2222-4222-8222-222222222222';
const ROW = '33333333-3333-4333-8333-333333333333';
const PAGE = '44444444-4444-4444-8444-444444444444';

function parse(href: string) {
  return parseAgentHandoff(new URL(href, 'https://app.test').searchParams);
}

describe('agent handoff', () => {
  it('sends equivalent exact issue, crawl and revision references from both surfaces', () => {
    const input = {
      issueGroup: { crawlId: DATASET, groupId: ROW, siteUrlId: PAGE },
      siteFacts: { crawlId: DATASET },
      outputRevision: { outputId: ACTION, revisionId: ROW },
    };
    const full = parse(agentHandoffHref(input));
    expect(full).toEqual(agentHandoff(input));
    expect(full.context).toEqual({
      issue_group_reference: { crawl_id: DATASET, group_id: ROW, site_url_id: PAGE },
      site_facts_reference: { crawl_id: DATASET },
      output_revision_reference: { output_id: ACTION, revision_id: ROW },
    });
    const chips = contextChips(full.context);
    expect(chips).toHaveLength(3);
    for (const chip of chips)
      expect(withoutContext(full.context, chip.key)[chip.key]).toBeUndefined();
  });
  it('carries a selected skill and workflow without sending a chat, dropping a malformed id', () => {
    const href = agentHandoffHref({
      skillId: 'earned_authority',
      workflowId: 'linkedin_post',
      prompt: 'Investigate this',
    });
    expect(parse(href)).toMatchObject({
      skillId: 'earned_authority',
      workflowId: 'linkedin_post',
      prompt: 'Investigate this',
      context: {},
    });
    expect(parse('/agent?workflow=Not%20an%20id')).not.toHaveProperty('workflowId');
  });
  it('round-trips typed references and a prefilled question', () => {
    const handoff = parse(
      agentHandoffHref({
        actionId: ACTION,
        siteUrlId: PAGE,
        targetUrl: 'https://acme.test/pricing',
        searchIntelligence: { datasetId: DATASET, rowIds: [ROW] },
        prompt: '  Why is this page not cited?  ',
      }),
    );

    expect(handoff).toEqual({
      actionId: ACTION,
      prompt: 'Why is this page not cited?',
      context: {
        target_site_url_id: PAGE,
        target_url: 'https://acme.test/pricing',
        search_intelligence_reference: { dataset_id: DATASET, row_ids: [ROW] },
      },
    });
  });

  it('drops malformed identifiers and non-web URLs instead of sending them', () => {
    const handoff = parse(
      '/agent?action_id=nope&opportunity_id=1&target_url=javascript:alert(1)&si_dataset_id=' +
        DATASET,
    );
    expect(handoff).toEqual({ actionId: undefined, prompt: undefined, context: {} });
  });

  it('removes a page as one chip whether named by URL or id', () => {
    const context = { target_url: 'https://acme.test/a', target_site_url_id: PAGE };
    expect(contextChips(context)).toEqual([{ key: 'target_url', label: 'https://acme.test/a' }]);
    expect(withoutContext(context, 'target_url')).toEqual({});
  });
});

describe('developerTicket', () => {
  const day = (iso: string) => iso.slice(0, 10);
  const pageAction = {
    target_label: 'https://acme.test/pricing',
    target_url: 'https://acme.test/pricing',
    handoff: { message: 'Fix structured data on https://acme.test/pricing.' },
    members: [
      { id: ACTION, title: 'Missing structured data', remediation: 'Add Product schema.' },
      { id: PAGE, title: 'Thin\ncontent', remediation: 'Add Product schema.' },
    ],
    member_measurement: { [ACTION]: 'next_crawl' as const, [PAGE]: null },
    diagnosis: { donts: ['Do not hide content.'] },
    cohort: null,
    declaration: null,
  };

  it('writes an undeclared page Action as Markdown with dated evidence and how to record the deployment', () => {
    expect(
      developerTicket(
        pageAction,
        [
          {
            key: `opportunity/${ACTION}`,
            label: 'Missing structured data',
            at: '2026-11-08T09:00:00Z',
            basis: 'inferred',
            href: null,
          },
          {
            key: `site_crawl/${ROW}`,
            label: 'Site crawl',
            at: null,
            basis: 'observed',
            href: '/site',
          },
        ],
        day,
      ),
    ).toBe(
      [
        '# https://acme.test/pricing',
        '',
        'Fix structured data on https://acme.test/pricing.',
        '',
        '## Issue',
        '',
        '- Missing structured data',
        '- Thin content',
        '',
        '## Affected pages',
        '',
        '- https://acme.test/pricing',
        '',
        '## Evidence',
        '',
        '- Missing structured data: inferred, 2026-11-08',
        '- Site crawl: observed, date not recorded',
        '',
        '## Minimal patch',
        '',
        '1. Add Product schema.',
        '',
        'Avoid:',
        '',
        '- Do not hide content.',
        '',
        '## How it will be verified',
        '',
        '- Missing structured data: checked by the next crawl of this page',
        '- Thin content: not measured automatically',
        '',
        'When it ships, record the deployment on the Action in CiteLadder: Mark implemented with the day it went live and the release, pull request or commit. Readings before that day are not counted.',
        '',
      ].join('\n'),
    );
  });

  it('lists an issue family’s pages up to its bound and a declared Action’s deployment and checks', () => {
    const pages = Array.from({ length: 52 }, (_, index) => ({
      site_url_id: PAGE,
      url: `https://acme.test/p/${index}`,
    }));
    const ticket = developerTicket(
      {
        ...pageAction,
        target_label: 'Images without alt text',
        target_url: null,
        cohort: {
          rule_label: 'Images without alt text',
          page_count: 120,
          pages,
          crawl_completed_at: '2026-11-07T00:00:00Z',
        },
        declaration: {
          declared_implemented_at: '2026-11-09T15:00:00Z',
          deployed_by: 'dev@acme.test',
          deployment_reference: 'v2.4.1',
          checks: [{ kind: 'site_rule', state: 'met', reason: null }],
        },
      },
      [],
      day,
    );
    const lines = ticket.split('\n');
    expect(
      lines.slice(lines.indexOf('## Affected pages'), lines.indexOf('## Affected pages') + 4),
    ).toEqual([
      '## Affected pages',
      '',
      'Images without alt text on 120 pages (crawl completed 2026-11-07):',
      '',
    ]);
    expect(lines).toContain('- https://acme.test/p/49');
    expect(lines).not.toContain('- https://acme.test/p/50');
    // 52 stored pages of 120: 2 more are on the Action, 68 are stored nowhere.
    expect(lines.slice(lines.indexOf('- https://acme.test/p/49') + 1).slice(0, 2)).toEqual([
      '- and 2 more pages, listed on the Action in CiteLadder',
      '- and 68 more pages with this issue, not listed',
    ]);
    expect(lines).toContain('- No evidence is recorded for this Action.');
    expect(
      ticket.endsWith(
        [
          '## How it will be verified',
          '',
          'Deployed on 2026-11-09, recorded by dev@acme.test (v2.4.1).',
          '',
          '- Site Health check passes: Met',
          '',
        ].join('\n'),
      ),
    ).toBe(true);
  });
});
