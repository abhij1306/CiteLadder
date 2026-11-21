import { screen, waitFor, within } from '@testing-library/react';
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
  measurement: null,
  priority_score: 82.5,
  priority_band: 'high',
  families: ['site_changes'],
  approach: 'fix_technical',
  goal: 'own_pages',
  grouping: 'regressed',
  skill_id: 'technical_health',
  member_count: 1,
  declarable_member_count: 1,
  page_count: null,
  finding_class: null,
  summary: null,
  handoff: { context: 'action', message: MESSAGE },
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const group: Action = {
  ...action,
  target_kind: 'issue_family',
  target_label: 'Form controls missing accessible names',
  target_url: null,
  families: ['site_health'],
  goal: 'read_site',
  grouping: 'aeo',
  page_count: 12,
};

const urlId = (index: number) => `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`;
const url = (index: number) => ({
  site_url_id: urlId(index),
  url: `https://acme.test/shop/p${String(index + 1).padStart(2, '0')}`,
  page_kind: 'product',
  open_action_count: 2,
});

function finding(target: Pick<Action, 'id' | 'target_url' | 'target_label'>, extra = {}) {
  return {
    id: FINDING,
    project_id: PROJECT,
    rule_id: 'site_change_potential_regression',
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

function serve(current: Action, detail: Record<string, unknown> = {}) {
  const patches: unknown[] = [];
  const cursors: (string | null)[] = [];
  let status = current.status;
  mswServer.use(
    http.get(`/api/v1/actions/${current.id}`, () =>
      HttpResponse.json({
        ...current,
        status,
        diagnosis: { approach: current.approach },
        members: [finding(current)],
        member_measurement: { [FINDING]: 'next_crawl' },
        declarable_since: '2026-01-01T00:00:00Z',
        declaration: null,
        ...detail,
      }),
    ),
    http.get(`/api/v1/actions/${current.id}/urls`, ({ request }) => {
      cursors.push(new URL(request.url).searchParams.get('cursor'));
      return HttpResponse.json({
        whole_site: false,
        total: 12,
        items: [url(10), url(11)],
        next_cursor: null,
      });
    }),
    http.patch(`/api/v1/actions/${current.id}`, async ({ request }) => {
      const body = actionStatusUpdateRequestSchema.parse(await request.json());
      patches.push(body);
      status = body.status;
      return HttpResponse.json({ ...current, status });
    }),
  );
  return { patches, cursors };
}

const GROUP_URLS = {
  urls: {
    whole_site: false,
    total: 12,
    items: Array.from({ length: 10 }, (_, index) => url(index)),
    next_cursor: 'after-ten',
  },
  cohort: null,
};

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/actions/:actionId" element={<ActionDetailScreen />} />
    </Routes>,
    { initialEntries: [`/actions/${ACTION}`], projectSelection: selection },
  );
}

function chatOf(link: HTMLElement) {
  const target = new URL(link.getAttribute('href')!, 'https://app.test');
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(target.searchParams.keys())) {
    const values = target.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0]!;
  }
  return { path: target.pathname, ...query };
}

const dockButtons = async () =>
  within(await screen.findByRole('toolbar', { name: 'Work on this action' }))
    .queryAllByRole('button')
    .map((button) => button.textContent);

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('An issue-group Action page', () => {
  it('lists its first 10 URLs, then appends 11–12 from the URL read with Show 2 more', async () => {
    const { cursors } = serve(group, GROUP_URLS);
    const user = userEvent.setup();
    renderDetail();

    const urls = await screen.findByRole('list', { name: 'URLs' });
    expect(screen.getByRole('heading', { name: 'URLs · 12' })).toBeVisible();
    expect(within(urls).getAllByRole('listitem')).toHaveLength(10);
    expect(within(urls).getAllByRole('listitem')[0]).toHaveTextContent('/shop/p01Product2 actions');
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));

    expect(await within(urls).findByText('p12')).toBeVisible();
    expect(
      within(urls)
        .getAllByRole('link')
        .slice(9)
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      `/actions/urls/${urlId(9)}?project=${PROJECT}`,
      `/actions/urls/${urlId(10)}?project=${PROJECT}`,
      `/actions/urls/${urlId(11)}?project=${PROJECT}`,
    ]);
    expect(cursors).toEqual(['after-ten']);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });

  it('sends the whole group to the Agent, or only the ticked URLs', async () => {
    serve(group, GROUP_URLS);
    const user = userEvent.setup();
    renderDetail();

    const all = await screen.findByRole('link', { name: 'Fix all 12 with Agent' });
    expect(chatOf(all)).toEqual({ path: '/agent', action_id: ACTION, project: PROJECT });

    await user.click(screen.getByRole('checkbox', { name: 'Select https://acme.test/shop/p02' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select https://acme.test/shop/p05' }));
    expect(chatOf(screen.getByRole('link', { name: 'Fix 2 selected with Agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      action_url_id: [urlId(1), urlId(4)],
      project: PROJECT,
    });
  });
});

const declared = (checks: unknown[]) => ({
  id: '77777777-7777-4777-8777-777777777777',
  action_id: ACTION,
  output_revision_id: null,
  member_opportunity_ids: [FINDING],
  opportunity_snapshot_id: null,
  resolved_before_snapshot_id: null,
  target_site_url_ids: [],
  target_external_url: null,
  declared_implemented_at: NOW,
  deployed_by: null,
  deployment_reference: null,
  expected_checks: [],
  state: 'observed',
  limitations: [],
  verification_events: [],
  legs: [],
  checks,
  measured_until: NOW,
  created_at: NOW,
});
const metCheck = {
  index: 0,
  kind: 'site_rule',
  leg: 'next_crawl',
  state: 'met',
  reason: null,
  observed_at: NOW,
  source_kind: 'site_crawl',
  source_id: null,
  subject: 'Missing structured data',
};

describe('A missing Action', () => {
  it('reads Not found on a 404, and Couldn’t load on any other failure', async () => {
    mswServer.use(
      http.get(`/api/v1/actions/${ACTION}`, () =>
        HttpResponse.json({ detail: 'Not found' }, { status: 404 }),
      ),
    );
    const first = renderDetail();
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this Action")).toBeNull();
    first.unmount();

    mswServer.use(
      http.get(`/api/v1/actions/${ACTION}`, () =>
        HttpResponse.json({ detail: 'Unavailable' }, { status: 503 }),
      ),
    );
    renderDetail();
    expect(await screen.findByText("Couldn't load this Action")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });
});

describe('A Done Action’s status', () => {
  it.each([
    ['Done', 'with no check', []],
    ['DoneVerified', 'with a passing check', [metCheck]],
  ] as const)('reads %j %s', async (status, _, checks) => {
    serve(
      { ...action, status: 'done', measurement: 'verified' },
      { declaration: declared([...checks]) },
    );
    renderDetail();

    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getAllByRole('definition').at(0)?.textContent).toBe(status);
  });
});

describe('An Action page’s dock', () => {
  it.each([
    ['open', ['Decline', 'Accept']],
    ['in_progress', ['Decline', 'Mark implemented']],
    ['dismissed', ['Restore', 'Accept']],
    ['done', []],
  ] as const)('offers %s Actions %j', async (status, buttons) => {
    serve({ ...action, status });
    renderDetail();
    expect(await dockButtons()).toEqual(buttons);
  });

  it('moves a New Action to In progress on Accept, then offers Decline and Mark implemented', async () => {
    const { patches } = serve(action);
    const user = userEvent.setup();
    renderDetail();

    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getAllByRole('definition')[0]).toHaveTextContent('New');
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(within(details).getAllByRole('definition')[0]).toHaveTextContent('In progress');
    expect(await screen.findByText('Action accepted. It is in progress.')).toBeInTheDocument();
    expect(patches).toEqual([{ status: 'in_progress' }]);
    expect(await dockButtons()).toEqual(['Decline', 'Mark implemented']);
  });

  it('puts the status back when the server refuses the change', async () => {
    serve(action);
    let refused = 0;
    mswServer.use(
      http.patch(`/api/v1/actions/${ACTION}`, () => {
        refused += 1;
        return HttpResponse.json({ detail: 'Conflict' }, { status: 409 });
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    const details = await screen.findByRole('region', { name: 'Details' });
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(refused).toBe(1));
    await waitFor(() =>
      expect(within(details).getAllByRole('definition')[0]).toHaveTextContent('New'),
    );
    expect(await dockButtons()).toEqual(['Decline', 'Accept']);
  });
});

const angleEvidence = {
  run_id: '77777777-7777-4777-8777-777777777777',
  lineage_id: '88888888-8888-4888-8888-888888888888',
  topic_id: null,
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

describe('An Action page’s sections and hand-off', () => {
  it('explains a content gap from its evidence and hands the page to the page workflow', async () => {
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
    renderDetail();

    const why = await screen.findByRole('region', { name: 'Why this matters' });
    expect(within(why).getByText('Pricing comparison')).toBeVisible();
    expect(within(why).getByText('Globex (globex.com) · 5 citations')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'What to do' })).getByRole('checkbox', {
        name: 'Cover the angle.',
      }),
    ).not.toBeChecked();
    expect(chatOf(screen.getByRole('link', { name: 'Work with Agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      target_url: 'https://acme.test/crm-pricing',
      workflow: 'optimize_page',
      project: PROJECT,
    });
  });

  it('hands a planned page to the article workflow with its finding', async () => {
    serve({
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
    });
    renderDetail();

    expect(chatOf(await screen.findByRole('link', { name: 'Work with Agent' }))).toEqual({
      path: '/agent',
      action_id: ACTION,
      opportunity_id: FINDING,
      workflow: 'article',
      project: PROJECT,
    });
  });

  it('captions an agent-proposed Action’s words as its suggestion', async () => {
    serve({ ...action, origin: 'agent' });
    renderDetail();

    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Suggested by the agent')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'What to do' })).queryByText(
        'Suggested by the agent',
      ),
    ).toBeNull();
  });

  it('copies the hand-off message and steps as a prompt', async () => {
    serve(action);
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Copy as prompt' }));
    expect(await navigator.clipboard.readText()).toBe(
      [MESSAGE, '', 'What to do:', '1. Add schema.org structured data.'].join('\n'),
    );
  });

  it('prepares a developer ticket as Markdown', async () => {
    serve(action);
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Prepare developer ticket' }));
    const dialog = await screen.findByRole('dialog', { name: 'Developer ticket' });
    const markdown = within(dialog).getByRole('textbox', { name: 'Developer ticket Markdown' });
    expect((markdown as HTMLTextAreaElement).value.split('\n').slice(0, 3)).toEqual([
      '# https://acme.test/pricing',
      '',
      MESSAGE,
    ]);
  });
});
