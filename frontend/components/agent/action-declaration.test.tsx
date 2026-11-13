import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import type { ActionDeclaration } from '@/lib/api/actions';
import { localDay } from '@/lib/opportunities/declaration-date';

import { isDeclarable, MarkImplementedButton } from './action-declaration';
import { DeclarationStatus } from './declaration-status';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-25T10:00:00Z';
const selection = {
  activeProjectId: PROJECT,
  activeProject: makeProject({ id: PROJECT }),
  status: 'ready' as const,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const daysAgo = (days: number) => {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return at;
};

describe('Mark implemented', () => {
  it('declares the chosen go-live day and what shipped it, and refuses a day outside the window', async () => {
    const posted: { declared_implemented_at: string; deployment_reference: string | null }[] = [];
    mswServer.use(
      http.post(`/api/v1/actions/${ACTION}/declaration`, async ({ request }) => {
        posted.push((await request.json()) as (typeof posted)[number]);
        return HttpResponse.json({ error: { message: 'stop here' } }, { status: 409 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <MarkImplementedButton
        workspaceId={WORKSPACE}
        revision={null}
        action={{
          id: ACTION,
          project_id: PROJECT,
          members: [{ id: MEMBER, title: 'Missing structured data' } as never],
          member_measurement: { [MEMBER]: null },
          declarable_since: daysAgo(30).toISOString(),
        }}
      />,
      { projectSelection: selection },
    );
    await user.click(screen.getByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    const field = within(dialog).getByLabelText('Go-live date');
    const submit = within(dialog).getByRole('button', { name: 'Declare implemented' });

    await user.clear(field);
    await user.type(field, localDay(daysAgo(40)));
    expect(submit).toBeDisabled();

    const day = localDay(daysAgo(3));
    await user.clear(field);
    await user.type(field, day);
    await user.type(within(dialog).getByLabelText('What shipped it?'), '  v2.4.1 ');
    await user.click(submit);
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(localDay(new Date(posted[0]!.declared_implemented_at))).toBe(day);
    expect(posted[0]!.deployment_reference).toBe('v2.4.1');
  });

  it('says which page a content gap will be measured by before declaring', async () => {
    const user = userEvent.setup();
    const gap = { prompts: [], members: [], window: { start: NOW, end: NOW } };
    const NEW_PAGE = '66666666-6666-4666-8666-666666666666';
    renderWithProviders(
      <MarkImplementedButton
        workspaceId={WORKSPACE}
        revision={{ id: '77777777-7777-4777-8777-777777777777', number: 2 }}
        action={{
          id: ACTION,
          project_id: PROJECT,
          members: [
            {
              id: MEMBER,
              title: 'Cited content angle your page does not win',
              content_gap_evidence: { ...gap, url: 'https://acme.test/pricing' },
            } as never,
            {
              id: NEW_PAGE,
              title: 'Cited content angle you have no page for',
              content_gap_evidence: { ...gap, planned_page_key: 'planned:setup-guide' },
            } as never,
          ],
          member_measurement: {
            [MEMBER]: 'next_visibility_run',
            [NEW_PAGE]: 'next_visibility_run',
          },
          declarable_since: daysAgo(30).toISOString(),
        }}
      />,
      { projectSelection: selection },
    );
    await user.click(screen.getByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    expect(
      within(dialog).getByText(
        "An AI answer cites your page: checks whether an AI answer to the angle's prompts cites https://acme.test/pricing.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "An AI answer cites your page: checks whether an AI answer to the angle's prompts cites a new page of yours, one not already cited for them.",
      ),
    ).toBeVisible();
  });
});

describe('Declarable', () => {
  it('offers an open Action whose findings a recrawl resolved, but not one that never had any', () => {
    expect(isDeclarable({ status: 'open', declarable_member_count: 1 })).toBe(true);
    expect(isDeclarable({ status: 'in_progress', declarable_member_count: 2 })).toBe(true);
    expect(isDeclarable({ status: 'open', declarable_member_count: 0 })).toBe(false);
    expect(isDeclarable({ status: 'dismissed', declarable_member_count: 1 })).toBe(false);
  });
});

describe('Declaration status', () => {
  const declaration = (checks: ActionDeclaration['checks']): ActionDeclaration => ({
    id: '44444444-4444-4444-8444-444444444444',
    action_id: ACTION,
    output_revision_id: null,
    member_opportunity_ids: [MEMBER],
    opportunity_snapshot_id: '55555555-5555-4555-8555-555555555555',
    resolved_before_snapshot_id: null,
    target_site_url_ids: [],
    target_external_url: null,
    declared_implemented_at: NOW,
    deployed_by: 'dev@acme.test',
    deployment_reference: null,
    expected_checks: [],
    state: 'observed',
    limitations: [],
    verification_events: [],
    legs: [
      {
        leg: 'next_crawl',
        state: 'observed',
        due_at: null,
        last_evidence_at: NOW,
        source_id: null,
      },
    ],
    checks,
    measured_until: NOW,
    created_at: NOW,
  });
  const pageCheck = (state: ActionDeclaration['checks'][number]['state']) => ({
    index: 0,
    kind: 'site_rule',
    leg: 'next_crawl' as const,
    state,
    reason: state === 'unavailable' ? 'page_not_analyzed' : null,
    observed_at: NOW,
    source_kind: 'site_crawl',
    source_id: null,
    subject: 'Missing structured data',
  });

  it('shows who recorded the deployment and links what shipped it', () => {
    const recorded = renderWithProviders(
      <DeclarationStatus
        declaration={{
          ...declaration([]),
          deployment_reference: 'https://git.acme.test/site/pull/42',
        }}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(screen.getByText(/Deployment recorded by dev@acme\.test/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: /https:\/\/git\.acme\.test\/site\/pull\/42/ }),
    ).toHaveAttribute('href', 'https://git.acme.test/site/pull/42');
    recorded.unmount();
    renderWithProviders(
      <DeclarationStatus
        declaration={{ ...declaration([]), deployed_by: null, deployment_reference: 'v2.4.1' }}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(
      screen.getByText('Deployment recorded by a former workspace member', { exact: false }),
    ).toHaveTextContent('Deployment recorded by a former workspace member · v2.4.1');
    expect(screen.queryByRole('link', { name: /v2\.4\.1/ })).not.toBeInTheDocument();
  });

  it('says findings resolved before go-live are not credited, apart from unmeasurable ones', () => {
    const unmeasured = renderWithProviders(
      <DeclarationStatus declaration={declaration([])} workspaceId={WORKSPACE} />,
      { projectSelection: selection },
    );
    expect(screen.getByText(/No automatic check applies to these findings/)).toBeVisible();
    unmeasured.unmount();
    renderWithProviders(
      <DeclarationStatus
        declaration={{
          ...declaration([]),
          resolved_before_snapshot_id: '66666666-6666-4666-8666-666666666666',
        }}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(
      screen.getByText(
        'These findings were already resolved before this went live, so the outcome is not credited to this change and nothing is measured.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/No automatic check applies/)).not.toBeInTheDocument();
  });

  it("links a prompt check to that prompt's history", () => {
    const promptId = '33333333-3333-4333-8333-333333333333';
    renderWithProviders(
      <DeclarationStatus
        declaration={declaration([
          {
            ...pageCheck('met'),
            kind: 'visibility_metric',
            leg: 'next_visibility_run',
            subject: 'best crm for agencies',
            prompt_id: promptId,
          },
        ])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(screen.getByRole('link', { name: 'best crm for agencies' })).toHaveAttribute(
      'href',
      expect.stringMatching(new RegExp(`^/prompts/${promptId}(\\?|$)`)),
    );
  });

  it('names the page an owned-URL check waits for, or a new page of yours, and what it cannot show', () => {
    const cited = (subject: string | null, state: 'waiting' | 'unavailable') => ({
      ...pageCheck(state),
      kind: 'owned_url_cited',
      leg: 'next_visibility_run' as const,
      reason: state === 'unavailable' ? 'prompts_not_in_run' : null,
      subject,
    });
    renderWithProviders(
      <DeclarationStatus
        declaration={declaration([
          cited('https://acme.test/pricing', 'unavailable'),
          { ...cited(null, 'waiting'), index: 1 },
        ])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    const checks = within(screen.getByRole('list', { name: 'Checks' })).getAllByRole('listitem');
    expect(checks.map((item) => item.textContent)).toEqual([
      expect.stringMatching(
        /^An AI answer cites your pageNot measurable yethttps:\/\/acme\.test\/pricingA citation shows the page was cited, not which version of it the AI engine read\.None of these prompts was part of that run\./,
      ),
      expect.stringMatching(
        /^An AI answer cites your pageWaitingA new page of yours, not one already cited for these prompts/,
      ),
    ]);
  });

  it('reads an issue family as verified, partially resolved, still failing or inconclusive', () => {
    const family = (
      index: number,
      state: 'met' | 'unmet' | 'unavailable',
      reason: string | null,
      pages: {
        failing: { site_url_id: string; url: string }[];
        passing: number;
        not_applicable: number;
        unread: number;
        uncovered?: number;
      },
    ) => ({
      ...pageCheck(state),
      index,
      kind: 'issue_family',
      reason,
      subject: 'Missing viewport meta tag',
      pages: { uncovered: 0, ...pages },
    });
    const stuck = {
      site_url_id: '77777777-7777-4777-8777-777777777777',
      url: 'https://acme.test/b',
    };
    renderWithProviders(
      <DeclarationStatus
        declaration={declaration([
          family(0, 'met', null, { failing: [], passing: 2, not_applicable: 1, unread: 0 }),
          family(1, 'unmet', 'partially_resolved', {
            failing: [stuck],
            passing: 1,
            not_applicable: 0,
            unread: 0,
          }),
          family(2, 'unmet', 'still_failing', {
            failing: [stuck],
            passing: 0,
            not_applicable: 0,
            unread: 2,
          }),
          family(3, 'unavailable', 'cohort_partly_analyzed', {
            failing: [],
            passing: 2,
            not_applicable: 0,
            unread: 1,
          }),
          // A reason this screen does not know claims no failure subtype.
          family(4, 'unmet', null, { failing: [], passing: 0, not_applicable: 0, unread: 0 }),
          // Every checked page passes, but the family ran past its cohort.
          family(5, 'unavailable', 'cohort_sampled', {
            failing: [],
            passing: 2,
            not_applicable: 0,
            unread: 0,
            uncovered: 3,
          }),
        ])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    // Each check's own row; a family's failing pages are a list inside it.
    const rows = [...screen.getByRole('list', { name: 'Checks' }).children];
    const check = 'Every affected page passes the Site Health check';
    const subject = 'Missing viewport meta tag';
    const read = 'Read Sep 25, 2026';
    expect(rows.map((item) => item.textContent)).toEqual([
      `${check}Verified${subject}2 pages pass · 0 pages still fail · 1 page no longer applies${read}`,
      `${check}Partially resolved${subject}1 page passes · 1 page still failshttps://acme.test/bSome affected pages now pass; the pages listed still fail. · ${read}`,
      `${check}Still failing${subject}0 pages pass · 1 page still fails · 2 pages not readhttps://acme.test/bNo affected page the crawl read passes yet. · ${read}`,
      `${check}Inconclusive${subject}2 pages pass · 0 pages still fail · 1 page not readThe affected pages that crawl read pass, but it did not read them all. Run a crawl that includes the rest. · ${read}`,
      `${check}Not met${subject}0 pages pass · 0 pages still fail${read}`,
      `${check}Inconclusive${subject}2 pages pass · 0 pages still fail · 3 pages not checkedEvery checked page passes or no longer applies, but the issue was on more pages than one check covers, so it cannot be verified on all of them. · ${read}`,
    ]);
    expect(screen.getAllByRole('list', { name: 'Pages still failing' })).toHaveLength(2);
  });

  it('offers a crawl while a page check lacks a met reading, and says why', () => {
    const { unmount } = renderWithProviders(
      <DeclarationStatus
        declaration={declaration([pageCheck('unavailable')])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(screen.getByText(/The page was not read in that crawl/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run crawl now' })).toBeEnabled();
    unmount();

    renderWithProviders(
      <DeclarationStatus declaration={declaration([pageCheck('met')])} workspaceId={WORKSPACE} />,
      { projectSelection: selection },
    );
    expect(screen.queryByRole('button', { name: 'Run crawl now' })).not.toBeInTheDocument();
  });
});
