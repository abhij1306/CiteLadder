import { describe, expect, it } from 'vite-plus/test';

import {
  agentHandoff,
  agentHandoffHref,
  contextChips,
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
