import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { actionStatusUpdateRequestSchema } from '@citeladder/contracts/actions';

import type { Action } from '@/lib/api/actions';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ActionDetailScreen } from './action-detail-screen';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';
const FINDING = '44444444-4444-4444-8444-444444444444';
const PROMPT = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-11-10T10:00:00Z';

const selection = {
  activeProjectId: PROJECT,
  activeProject: makeProject({ id: PROJECT }),
  status: 'ready' as const,
};

const MESSAGE = 'Fix "Missing structured data on owned page" on https://acme.test/pricing.';

const action: Action = {
  id: ACTION,
  project_id: PROJECT,
  target_kind: 'page',
  target_label: 'https://acme.test/pricing',
  target_url: 'https://acme.test/pricing',
  target_prompt_id: null,
  origin: 'evidence',
  status: 'open',
  priority_score: 82.5,
  priority_band: 'high',
  families: ['site_health'],
  approach: 'fix_technical',
  group: 'fix_site',
  skill_id: 'technical_health',
  member_count: 1,
  declarable_member_count: 1,
  page_count: null,
  handoff: { context: 'action', message: MESSAGE },
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
};

function finding(target: Pick<Action, 'id' | 'target_url' | 'target_label'>, extra = {}) {
  return {
    id: FINDING,
    project_id: PROJECT,
    rule_id: 'missing_structured_data',
    opportunity_type: 'site',
    severity: 'medium',
    priority_score: 82.5,
    title: 'Missing structured data on owned page',
    target_key: 'x',
    target_prompt_id: null,
    target_url: target.target_url,
    target_theme: null,
    target_label: target.target_label,
    action_id: target.id,
    system_rank: 1,
    display_rank: 1,
    order_source: 'system',
    priority_factors: {},
    evidence_summary: { count: 1, kinds: [] },
    created_at: NOW,
    updated_at: NOW,
    remediation: 'Add schema.org structured data.',
    content_gap_evidence: null,
    ...extra,
  };
}

/** Serves one Action's detail and records every status change the page sends. */
function serve(current: Action, detail: Record<string, unknown> = {}) {
  const patches: unknown[] = [];
  let status = current.status;
  mswServer.use(
    http.get(`/api/v1/actions/${current.id}`, () =>
      HttpResponse.json({
        ...current,
        status,
        diagnosis: {
          approach: current.approach,
          donts: ['Do not rewrite the page copy to work around a technical defect.'],
          measure_with: ['next_crawl'],
        },
        members: [finding(current)],
        member_measurement: { [FINDING]: 'next_crawl' },
        declarable_since: '2026-01-01T00:00:00Z',
        declaration: null,
        ...detail,
      }),
    ),
    http.patch(`/api/v1/actions/${current.id}`, async ({ request }) => {
      const body = actionStatusUpdateRequestSchema.parse(await request.json());
      patches.push(body);
      status = body.status;
      return HttpResponse.json({ ...current, status });
    }),
    http.get(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get('/api/v1/agent/skills', () =>
      HttpResponse.json({ skills: [], limits: { mentions_max: 5 } }),
    ),
  );
  return patches;
}

function renderDetail(actionId = ACTION) {
  renderWithProviders(
    <Routes>
      <Route path="/agent/actions/:actionId" element={<ActionDetailScreen />} />
    </Routes>,
    { initialEntries: [`/agent/actions/${actionId}`], projectSelection: selection },
  );
}

/** The New chat a link opens: its path and its query, as one object. */
function chatOf(link: HTMLElement) {
  const url = new URL(link.getAttribute('href')!, 'https://app.test');
  return { path: url.pathname, ...Object.fromEntries(url.searchParams) };
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('An Action page', () => {
  it('reads as one column from the breadcrumb to the chats', async () => {
    serve(action);
    const user = userEvent.setup();
    renderDetail();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'acme.test/pricing' }),
    ).toBeVisible();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Actions' })).toHaveAttribute(
      'href',
      `/agent/actions?project=${PROJECT}`,
    );
    expect(within(trail).getByText('https://acme.test/pricing')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Overview', 'Evidence', 'What to do', 'Measure with', 'Avoid', 'Findings', 'Chats']);

    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText(MESSAGE)).toBeVisible();
    expect(within(overview).getByText('Missing structured data on owned page')).toBeVisible();

    const details = within(screen.getByRole('region', { name: 'Details' }));
    expect(details.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Status',
      'Priority',
      'Action type',
      'Target',
      'Source',
    ]);
    expect(details.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'Open',
      'High',
      'Fix a technical issue',
      'PageOpen the page (opens in a new tab)',
      'Site Health',
    ]);

    expect(
      within(screen.getByRole('region', { name: 'What to do' })).getByRole('listitem'),
    ).toHaveTextContent('Add schema.org structured data.');
    expect(screen.getByText('The next crawl of this page')).toBeVisible();

    await user.click(within(overview).getByRole('button', { name: 'Copy as prompt' }));
    expect(await navigator.clipboard.readText()).toBe(
      `${MESSAGE}\n\nWhat to do:\n1. Add schema.org structured data.`,
    );
  });

  it('names a long page short in the header and shows its full address in the breadcrumb', async () => {
    const stored =
      'https://www.bestandless.com.au/Categories/Women/Women%2527s-Clothing/Women%2527s-Dresses/WR3458_PAISLEY';
    serve({ ...action, target_label: stored, target_url: stored });
    renderDetail();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'bestandless.com.au/…/WR3458_PAISLEY' }),
    ).toBeVisible();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(trail).getByText(
        "https://www.bestandless.com.au/Categories/Women/Women's-Clothing/Women's-Dresses/WR3458_PAISLEY",
      ),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('floats Dismiss, Mark implemented and Work with the agent at the foot of the page', async () => {
    const patches = serve(action);
    const user = userEvent.setup();
    renderDetail();

    const bar = within(await screen.findByRole('group', { name: 'Work on this Action' }));
    expect(bar.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Dismiss',
      'Mark implemented',
    ]);
    expect(chatOf(bar.getByRole('link', { name: 'Work with the agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      project: PROJECT,
    });

    await user.click(bar.getByRole('button', { name: 'Mark implemented' }));
    expect(await screen.findByRole('dialog', { name: 'Mark implemented' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(bar.getByRole('button', { name: 'Dismiss' }));
    expect(await bar.findByRole('button', { name: 'Reopen' })).toBeVisible();
    expect(patches).toEqual([{ status: 'dismissed' }]);
    // A dismissed Action is not declared, so only Reopen and the Agent remain.
    expect(bar.queryByRole('button', { name: 'Mark implemented' })).toBeNull();
  });
});

const angleEvidence = {
  run_id: '77777777-7777-4777-8777-777777777777',
  lineage_id: '88888888-8888-4888-8888-888888888888',
  topic_id: null,
  // As recorded at the refresh: one prompt with its text, one the library no longer had.
  prompts: [
    { id: PROMPT, text: 'Which CRM is cheapest?' },
    { id: '67676767-6767-4767-8767-676767676767', text: null },
  ],
  engines: ['chatgpt'],
  citation_count: 9,
  domain_count: 4,
  competitor_count: 2,
  member_count: 25,
  declarable_member_count: 25,
  members: [
    {
      url: 'https://globex.com/pricing',
      title: 'Globex pricing explained',
      domain: 'globex.com',
      classification: 'competitor',
      matched_competitor: 'Globex',
      citation_count: 5,
    },
    {
      url: 'https://review.example/crm-pricing',
      title: 'CRM pricing compared',
      domain: 'review.example',
      classification: 'third_party',
      matched_competitor: null,
      citation_count: 4,
    },
  ],
  window: { start: '2026-10-01T00:00:00Z', end: '2026-10-31T00:00:00Z' },
  methodology_version: 'content-angles-1',
  formula_version: 'content-gaps-1',
  limitations: [],
};

const pageGap: Action = {
  ...action,
  target_label: 'https://acme.test/crm-pricing',
  target_url: 'https://acme.test/crm-pricing',
  families: ['content_optimization'],
  approach: 'improve_existing',
  skill_id: 'content_create',
  handoff: {
    context: 'page_url',
    workflow_id: 'optimize_page',
    message: 'Improve https://acme.test/crm-pricing so AI answers cite it for Pricing comparison.',
  },
};

describe('A content-gap Action', () => {
  it('explains the gap from its evidence and hands the page to the page workflow', async () => {
    const libraryReads: string[] = [];
    serve(pageGap, {
      members: [
        finding(pageGap, {
          rule_id: 'content_gap_improve_page',
          opportunity_type: 'topic',
          title: 'Competitors are cited for content you lack',
          remediation: 'Cover the angle.',
          content_gap_evidence: {
            ...angleEvidence,
            angle_label: 'Pricing comparison',
            site_url_id: '99999999-9999-4999-8999-999999999999',
            url: 'https://acme.test/crm-pricing',
            match_method: 'model_pick',
          },
        }),
      ],
    });
    mswServer.use(
      http.get('/api/v1/opportunities/:id', ({ params }) => {
        libraryReads.push(`opportunity ${String(params.id)}`);
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 });
      }),
      http.get('/api/v1/prompt-sets', () => {
        libraryReads.push('prompt-sets');
        return HttpResponse.json({ prompt_sets: [] });
      }),
    );
    renderDetail();

    const why = await screen.findByRole('region', { name: 'Why this matters' });
    expect(await within(why).findByText('Pricing comparison')).toBeVisible();
    const counts = within(within(why).getByLabelText('Counts'));
    expect(counts.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      '9',
      '4',
      '2',
      '2',
      'Oct 1, 2026 to Oct 31, 2026',
    ]);
    expect(
      within(why).getByRole('link', { name: 'Globex pricing explained (opens in a new tab)' }),
    ).toHaveAttribute('href', 'https://globex.com/pricing');
    expect(within(why).getByText('Globex (globex.com) · 5 citations')).toBeVisible();
    expect(within(why).getByText('Competitor')).toBeVisible();
    expect(within(why).getByText('review.example · 4 citations')).toBeVisible();
    expect(within(why).getByText('Third-party')).toBeVisible();
    expect(within(why).getByText('The 2 most cited of 25 pages.')).toBeVisible();
    // Both stored prompts are listed, with no library or Opportunity read.
    const prompts = within(within(why).getByRole('region', { name: 'Prompts' }));
    expect(prompts.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Which CRM is cheapest?',
      'A prompt no longer in your library',
    ]);
    expect(prompts.getByRole('link', { name: 'Which CRM is cheapest?' })).toHaveAttribute(
      'href',
      `/prompts/${PROMPT}?project=${PROJECT}`,
    );
    expect(libraryReads).toEqual([]);

    expect(chatOf(screen.getByRole('link', { name: 'Work with the agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      target_url: 'https://acme.test/crm-pricing',
      workflow: 'optimize_page',
      project: PROJECT,
    });
  });

  it('opens an Action on one of the site’s content pages in the page workspace', async () => {
    serve(action, { editable_page: true });
    renderDetail();

    // Without `editable_page` this Action opens a plain Action chat (the floating bar test above).
    expect(chatOf(await screen.findByRole('link', { name: 'Work with the agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      target_url: 'https://acme.test/pricing',
      workflow: 'optimize_page',
      project: PROJECT,
    });
  });

  it('shows an issue family’s crawl and affected pages, and says how many are not listed', async () => {
    const family: Action = {
      ...action,
      target_kind: 'issue_family',
      target_label: 'Missing viewport meta tag',
      target_url: null,
      page_count: 179,
      handoff: {
        context: 'action',
        message: 'Write one fix that clears "Missing viewport meta tag" on every affected page.',
      },
    };
    const pages = Array.from({ length: 25 }, (_, index) => ({
      site_url_id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
      url: `https://acme.test/p${String(index).padStart(2, '0')}`,
    }));
    serve(family, {
      cohort: {
        rule_id: 'web.mobile_viewport',
        rule_label: 'Missing viewport meta tag',
        crawl_id: '88888888-8888-4888-8888-888888888888',
        group_id: '99999999-9999-4999-8999-999999999999',
        page_count: 179,
        pages,
        crawl_completed_at: '2026-11-01T09:00:00Z',
      },
    });
    const user = userEvent.setup();
    renderDetail();

    const section = await screen.findByRole('region', { name: 'Affected pages' });
    expect(
      within(section).getByText(
        /Missing viewport meta tag fails on 179 pages in the crawl completed/,
      ),
    ).toBeVisible();
    const list = within(section).getByRole('list', { name: 'Affected pages' });
    expect(within(list).getAllByRole('link')).toHaveLength(20);
    expect(
      within(section).getByText('154 more pages share this issue and are not listed.'),
    ).toBeVisible();
    await user.click(within(section).getByRole('button', { name: 'Show all 25 listed pages' }));
    expect(within(list).getAllByRole('link')).toHaveLength(25);
    expect(within(list).getAllByRole('link')[0]).toHaveAttribute('href', 'https://acme.test/p00');
  });

  it('prepares a developer ticket as Markdown and lists each record dated and marked inferred or observed', async () => {
    serve(action);
    const user = userEvent.setup();
    renderDetail();

    const evidence = await screen.findByRole('list', { name: 'Evidence records' });
    expect(within(evidence).getByRole('listitem').textContent).toBe(
      'Missing structured data on owned page · Inferred · Nov 10, 2026',
    );

    const overview = screen.getByRole('region', { name: 'Overview' });
    await user.click(within(overview).getByRole('button', { name: 'Prepare developer ticket' }));
    const dialog = await screen.findByRole('dialog', { name: 'Developer ticket' });
    const markdown = within(dialog).getByRole('textbox', { name: 'Developer ticket Markdown' });
    expect((markdown as HTMLTextAreaElement).value.split('\n').slice(0, 15)).toEqual([
      '# https://acme.test/pricing',
      '',
      MESSAGE,
      '',
      '## Issue',
      '',
      '- Missing structured data on owned page',
      '',
      '## Affected pages',
      '',
      '- https://acme.test/pricing',
      '',
      '## Evidence',
      '',
      '- Missing structured data on owned page: inferred, Nov 10, 2026',
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'Copy Markdown' }));
    expect(await navigator.clipboard.readText()).toBe((markdown as HTMLTextAreaElement).value);
  });

  it('hands a planned page to the article workflow with its finding', async () => {
    const planned: Action = {
      ...action,
      target_kind: 'planned_page',
      target_label: 'Setup guide',
      target_url: null,
      approach: 'create_new',
      handoff: {
        context: 'opportunity',
        workflow_id: 'article',
        opportunity_id: FINDING,
        message: 'Write a page about Setup guide for the prompts in this Action.',
      },
    };
    serve(planned);
    renderDetail();

    expect(chatOf(await screen.findByRole('link', { name: 'Work with the agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      opportunity_id: FINDING,
      workflow: 'article',
      project: PROJECT,
    });
  });
});
