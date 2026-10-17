import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Analytics } from './analytics';
import { createController } from './controller';
import { appPolicy } from './config';

const project = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const audit = '33333333-3333-4333-8333-333333333333';
const links = {
  application: 'https://app.example.test/visibility',
  onboarding: 'https://app.example.test/onboarding',
};
const result = (project_id = project) => ({
  surface: 'citeladder_analytics',
  selection: { project_id, audit_id: audit, view: 'overview' },
  links,
  evidence: { state: 'unavailable', reason: 'no_completed_measurement' },
});
const answerId = '44444444-4444-4444-8444-444444444444';
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-/u;
/** Everything a person or assistive technology can read, including collapsed sections. */
function shownText() {
  const labelled = [...document.querySelectorAll('[aria-label],[title],[alt]')].flatMap((node) =>
    ['aria-label', 'title', 'alt'].map((name) => node.getAttribute(name) ?? ''),
  );
  return [document.body.textContent ?? '', ...labelled].join(' ');
}
const overviewEvidence = {
  project_id: project,
  audit_id: audit,
  audit_status: 'completed',
  analyzer_version: '1',
  scoring_rule_version: '1',
  total_completed: 2,
  total_failed: 0,
  visibility_score: null,
  visibility_rate: 0.5,
  owned_citation_rate: 0,
  rankings: [
    {
      name: 'Competitor',
      is_brand: false,
      mention_rate: 0.25,
      citation_rate: null,
      share_of_voice: null,
      mention_count: 1,
      avg_position: null,
    },
  ],
  per_engine: [],
  avg_position: null,
  created_at: '2026-10-03T12:00:00Z',
};
const siteEvidence = {
  state: 'available',
  snapshot_id: audit,
  crawl_id: foreign,
  observed_at: '2026-10-01T12:00:00Z',
  scores: { web_fundamentals: 50, aeo_readiness: null, aeo_measurement_coverage: 0.5 },
  coverage: { selected_urls: 2, analyzed_urls: 1 },
  measurement_states: { coverage: 'partial', aeo: 'unknown' },
  versions: { analyzer: 'retained-analyzer', scoring: 'retained-scoring' },
};

describe('CiteLadder MCP App', () => {
  it('labels overview and source answers by project, date and prompt, never by ID', async () => {
    const user = userEvent.setup();
    const answer = {
      task_id: answerId,
      record_uri: `citeladder://visibility_result/${answerId}`,
      audit_id: audit,
      prompt_text: 'Best CRM for a small agency?',
      answer_text: 'Acme and Competitor are popular choices.',
      logical_engine: 'chatgpt',
      completed_at: '2026-10-03T12:00:00Z',
    };
    const responses: Record<string, unknown> = {
      list_projects: {
        projects: [{ id: project, workspace_name: 'Team', name: 'Acme' }],
        pagination: { next_cursor: null },
      },
      read_visibility_overview: overviewEvidence,
      read_visibility_sources: {
        items: [
          {
            key: 'publisher.example',
            responses: 2,
            annotations: 1,
            citation_rate: 0.5,
            citation_share: 1,
          },
        ],
        coverage: { responses: 2, prompts: 1, citations: 1 },
        pagination: { next_cursor: null },
      },
      read_visibility_results: { state: 'available', audit_id: audit, items: [answer] },
    };
    const controller = createController({
      call: vi.fn(async (name: string) => responses[name]),
      context: vi.fn(async () => undefined),
    });
    await controller.loadProjects();
    controller.receive({ ...result(), evidence: overviewEvidence });
    render(<Analytics controller={controller} />);
    expect(screen.getByText('Acme · Audit of 3 Oct 2026')).toBeVisible();
    expect(shownText()).not.toMatch(uuid);
    await act(() => controller.select({ ...controller.getSnapshot().selection, view: 'sources' }));
    await user.click(screen.getByRole('button', { name: 'Answers' }));
    expect(screen.getByRole('heading', { name: answer.prompt_text })).toBeVisible();
    expect(screen.getByText(answer.answer_text)).toBeVisible();
    expect(screen.getByText('Acme · Selected audit')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open CiteLadder' })).toHaveAttribute(
      'href',
      `https://app.example.test/visibility?project=${project}`,
    );
    expect(shownText()).not.toMatch(uuid);
    expect(shownText()).not.toContain('citeladder://');
  });
  it('labels Site Health by snapshot date, page URL and Action target, never by ID', async () => {
    const user = userEvent.setup();
    const responses: Record<string, unknown> = {
      read_site_pages: {
        state: 'available',
        items: [
          {
            site_url_id: foreign,
            url: 'https://acme.example/product',
            title: 'Acme product',
            link: `https://app.example.test/site/pages/${foreign}?project=${project}`,
            record_uri: `citeladder://site_page/${answerId}`,
          },
        ],
      },
      read_actions: {
        state: 'available',
        items: [
          {
            id: answerId,
            target_label: 'Pricing page',
            target_url: 'https://acme.example/pricing',
            approach: 'Answer common pricing questions on the page.',
            status: 'in_progress',
            priority_score: 0.8,
            link: `https://app.example.test/agent/actions/${answerId}?project=${project}`,
          },
        ],
      },
    };
    const controller = createController({
      call: vi.fn(async (name: string) => responses[name]),
      context: vi.fn(async () => undefined),
    });
    controller.receive({
      ...result(),
      selection: { project_id: project, view: 'site_health', snapshot_id: audit },
      evidence: siteEvidence,
    });
    render(<Analytics controller={controller} />);
    expect(screen.getByText('Site Health snapshot of 1 Oct 2026')).toBeVisible();
    await user.click(screen.getByText('Processing versions'));
    expect(screen.getByText('retained-scoring')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Read pages from this crawl' }));
    await user.click(screen.getByRole('button', { name: 'Read current Actions' }));
    expect(screen.getByRole('heading', { name: 'https://acme.example/product' })).toBeVisible();
    expect(screen.getByText('Acme product')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Pricing page' })).toBeVisible();
    expect(screen.getByText('in progress · https://acme.example/pricing')).toBeVisible();
    expect(shownText()).not.toMatch(uuid);
    expect(shownText()).not.toContain('citeladder://');
  });
  it.each([
    {
      name: 'oversized',
      payload: { ...result(), evidence: { retained: 'x'.repeat(appPolicy.maxResultBytes) } },
      error: /display limit/,
    },
    { name: 'malformed', payload: {}, error: /unavailable/ },
    { name: 'wrong selection', payload: result(foreign), error: /unavailable/ },
  ])('surfaces a $name host result and exits loading with a retry', ({ payload, error }) => {
    const controller = createController({
      call: vi.fn(async () => undefined),
      context: vi.fn(async () => undefined),
    });
    controller.begin({ project_id: project }, 'render_visibility');
    expect(() => controller.receive(payload)).not.toThrow();
    render(<Analytics controller={controller} />);
    expect(screen.getByRole('alert').textContent).toMatch(error);
    expect(screen.queryByText('Loading persisted evidence…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
  it('prevents overlapping crawl page reads and identifies their failure separately from findings', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const call = vi.fn(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    controller.receive({
      ...result(),
      selection: { project_id: project, view: 'site_health', snapshot_id: audit },
      evidence: siteEvidence,
    });
    render(<Analytics controller={controller} />);
    const button = screen.getByRole('button', { name: 'Read pages from this crawl' });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error('page read unavailable'));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Page evidence is unavailable/);
    expect(screen.queryByText('Loading persisted pages…')).not.toBeInTheDocument();
  });
  it('applies overlapping project pages once and ignores superseded listing failures', async () => {
    const first = { id: project, workspace_name: 'Team', name: 'Acme' };
    const next = { id: foreign, workspace_name: 'Team', name: 'Second' };
    const page = { projects: [next], pagination: { next_cursor: null } };
    const call = vi.fn(async (): Promise<unknown> => ({
      projects: [first],
      pagination: { next_cursor: 'next' },
    }));
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    await controller.loadProjects();
    let finish!: (value: typeof page) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const older = controller.loadProjects('next');
    call.mockResolvedValueOnce(page);
    await controller.loadProjects('next');
    finish(page);
    await older;
    expect(controller.getSnapshot().projects).toEqual([first, next]);
    let reject!: (error: Error) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const oldFailure = controller.loadProjects();
    await controller.loadProjects();
    reject(new Error('superseded read failure'));
    await oldFailure;
    expect(controller.getSnapshot().projects).toEqual([first]);
    expect(controller.getSnapshot().error).toBeNull();
  });
  it('recovers a host read failure without claiming account loss or letting late host errors clear local evidence', async () => {
    const user = userEvent.setup();
    const context = vi.fn(async () => undefined);
    const call = vi.fn(async () => result().evidence as unknown);
    const controller = createController({ call, context });
    call.mockResolvedValueOnce({
      projects: [{ id: project, workspace_name: 'Team', name: 'Acme' }],
      pagination: { next_cursor: null },
    });
    await controller.loadProjects();
    controller.receive(result());
    controller.begin({ project_id: project }, 'render_visibility');
    controller.failHostRead();
    render(<Analytics controller={controller} />);
    expect(screen.getByRole('combobox', { name: 'Project and workspace' })).toHaveTextContent(
      'Team / Acme',
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Evidence is unavailable/);
    expect(controller.getSnapshot().result).toBeNull();
    await vi.waitFor(() => expect(context).toHaveBeenLastCalledWith(null, undefined));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/No completed measurement/)).toBeInTheDocument();
    await act(() => controller.select({ project_id: foreign }));
    act(() => controller.failHostRead());
    expect(controller.getSnapshot().result?.selection?.project_id).toBe(foreign);
  });
  it.each(['render_site_health', undefined])(
    'accepts a Site Health host result with tool identity %s',
    (toolName) => {
      const controller = createController({
        call: vi.fn(async () => undefined),
        context: vi.fn(async () => undefined),
      });
      controller.begin({ project_id: project }, toolName);
      controller.receive({
        ...result(),
        selection: { project_id: project, view: 'site_health', snapshot_id: audit },
        evidence: siteEvidence,
      });
      render(<Analytics controller={controller} />);
      expect(screen.getByRole('tab', { name: 'Site Health' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText('Persisted Site Health')).toBeInTheDocument();
      expect(screen.queryByText('Loading persisted evidence…')).not.toBeInTheDocument();
    },
  );
  it.each(['overview', 'trends', 'sources', 'site_health'])(
    'treats malformed %s evidence as unavailable rather than a verified empty measurement',
    (view) => {
      const controller = createController({
        call: vi.fn(async () => undefined),
        context: vi.fn(async () => undefined),
      });
      controller.receive({
        ...result(),
        selection: {
          project_id: project,
          view,
          from_at: view === 'trends' ? '2026-10-01T00:00:00Z' : null,
          to_at: view === 'trends' ? '2026-10-02T00:00:00Z' : null,
        },
        evidence: { state: 'available', points: [{ corrupted: true }] },
      });
      render(<Analytics controller={controller} />);
      expect(screen.getByRole('alert').textContent).toMatch(/unavailable/);
      expect(
        screen.queryByText(/No (completed measurement|measured runs|persisted Site Health)/),
      ).not.toBeInTheDocument();
    },
  );
  it('tells an empty Actions list apart from an unavailable read', async () => {
    const user = userEvent.setup();
    const call = vi.fn(async (): Promise<unknown> => ({ state: 'available', items: [] }));
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    controller.receive({
      ...result(),
      selection: { project_id: project, view: 'site_health', snapshot_id: audit },
      evidence: siteEvidence,
    });
    render(<Analytics controller={controller} />);
    await user.click(screen.getByRole('button', { name: 'Read current Actions' }));
    expect(screen.getByRole('status').textContent).toBe('No open Actions for this project.');
    call.mockResolvedValueOnce({ state: 'unavailable', reason: 'projection_unavailable' });
    await user.click(screen.getByRole('button', { name: 'Read current Actions' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Actions are unavailable. Retry or reconnect.',
    );
  });
  it('rejects mismatched host filters and invalidates old host replies on local reads and disconnect', async () => {
    let finish!: (value: unknown) => void;
    const controller = createController({
      call: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      context: vi.fn(async () => undefined),
    });
    const selection = {
      project_id: project,
      view: 'trends',
      from_at: '2026-10-01T00:00:00Z',
      to_at: '2026-10-02T00:00:00Z',
    };
    controller.begin(selection, 'render_visibility');
    controller.receive({
      ...result(),
      selection: { ...selection, from_at: '2026-09-01T00:00:00Z' },
    });
    expect(controller.getSnapshot().result).toBeNull();
    const pending = controller.select({ ...selection, engine: 'gemini' });
    controller.receive({ ...result(), selection });
    expect(controller.getSnapshot().busy).toBe(true);
    finish({ state: 'available', points: [] });
    await pending;
    expect(controller.getSnapshot().selection?.engine).toBe('gemini');
    controller.disconnect();
    controller.receive({ ...result(), selection });
    expect(controller.getSnapshot().result).toBeNull();
    expect(controller.getSnapshot().error).toMatch(/Connect/);
  });
  it('ignores an old answer-fetch failure after a project switch and pins the application handoff', async () => {
    let fail!: (reason: Error) => void;
    const call = vi.fn(async () => ({ audit_id: audit, state: 'available' }) as unknown);
    const context = vi.fn(async () => undefined);
    const controller = createController({ call, context });
    controller.receive(result());
    call.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const pending = controller.fetchAnswer(`citeladder://visibility_result/${audit}`);
    await controller.select({ project_id: foreign });
    expect(controller.getSnapshot().result!.links.application).toBe(
      `https://app.example.test/visibility?project=${foreign}`,
    );
    fail(new Error('old fetch timed out'));
    await pending;
    expect(controller.getSnapshot().selection?.project_id).toBe(foreign);
    expect(controller.getSnapshot().result?.evidence.state).toBe('available');
    expect(controller.getSnapshot().error).toBeNull();
    await vi.waitFor(() =>
      expect(context).toHaveBeenLastCalledWith(
        expect.objectContaining({ project_id: foreign }),
        expect.objectContaining({ audit_id: audit }),
      ),
    );
    call.mockRejectedValueOnce(new Error('current access denied'));
    await controller.fetchAnswer(`citeladder://visibility_result/${audit}`);
    expect(controller.getSnapshot().result).toBeNull();
    expect(controller.getSnapshot().error).toMatch(/reconnect/);
  });
  it('renders observed zero separately from missing metrics and exposes keyboard view navigation', async () => {
    const user = userEvent.setup();
    const call = vi.fn(async () => ({
      state: 'unavailable',
      reason: 'no_measured_runs',
      points: [],
    }));
    const context = vi.fn(async () => undefined);
    const controller = createController({
      call,
      context,
    });
    controller.receive({ ...result(), evidence: overviewEvidence });
    render(<Analytics controller={controller} />);
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Overview competitor' }));
    await user.click(screen.getByRole('option', { name: 'Competitor' }));
    expect(call).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(context).toHaveBeenLastCalledWith(
        expect.objectContaining({ competitor: 'Competitor', audit_id: audit }),
        expect.objectContaining({ audit_id: audit }),
      ),
    );
    const tab = screen.getByRole('tab', { name: 'Overview' });
    tab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Trends' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sources' })).toBeDisabled();
    expect(screen.getByText('No measured runs in this window.')).toBeInTheDocument();
  });
  it('pins Sources to resolved evidence and clears it on a project switch, ignoring late responses', async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(async () => ({ state: 'available', audit_id: audit }) as unknown);
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    await controller.select({ project_id: project });
    await controller.select({ ...controller.getSnapshot().selection, view: 'sources' });
    expect(call).toHaveBeenLastCalledWith(
      'read_visibility_sources',
      expect.objectContaining({ project_id: project, audit_id: audit }),
    );
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.select({ project_id: project });
    expect(controller.getSnapshot().result).toBeNull();
    await controller.select({ project_id: foreign });
    finish({ audit_id: audit, state: 'available', private: 'old project evidence' });
    await pending;
    expect(controller.getSnapshot().result?.selection?.project_id).toBe(foreign);
    expect(controller.getSnapshot().result?.evidence).not.toHaveProperty('private');
    controller.receive(result(project));
    expect(controller.getSnapshot().selection?.project_id).toBe(foreign);
  });
  it('clears displayed snapshot and model context when access to its pages is revoked', async () => {
    const context = vi.fn(async () => undefined);
    const controller = createController({
      call: vi.fn(async () => {
        throw new Error('revoked');
      }),
      context,
    });
    controller.receive({
      ...result(),
      selection: { project_id: project, view: 'site_health' },
      evidence: { crawl_id: audit, state: 'partial' },
    });
    await expect(controller.sitePages()).rejects.toThrow('revoked');
    await Promise.resolve();
    expect(controller.getSnapshot().result).toBeNull();
    expect(controller.getSnapshot().error).toMatch(/reconnect/);
    expect(context).toHaveBeenLastCalledWith(null, undefined);
  });
  it('shows no-evidence and reconnect recovery without preserving old evidence on denied reads', async () => {
    const user = userEvent.setup();
    const call = vi.fn(async () => {
      throw new Error('revoked');
    });
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    call.mockResolvedValueOnce({
      projects: [{ id: project, workspace_name: 'Team', name: 'Acme' }],
      pagination: { next_cursor: null },
    } as never);
    await controller.loadProjects();
    controller.receive(result());
    render(<Analytics controller={controller} />);
    expect(screen.getByRole('combobox', { name: 'Project and workspace' })).toHaveTextContent(
      'Team / Acme',
    );
    expect(screen.getByText(/No completed measurement/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh connection' }));
    expect(screen.getByRole('alert').textContent).toMatch(/reconnect/);
    expect(screen.queryByText(/No completed measurement/)).not.toBeInTheDocument();
    expect(screen.queryByText('Team / Acme')).not.toBeInTheDocument();
    call.mockResolvedValueOnce({
      projects: [{ id: project, workspace_name: 'Team', name: 'Acme' }],
      pagination: { next_cursor: null },
    } as never);
    await user.click(screen.getByRole('button', { name: 'Refresh connection' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('uses concrete source drill-down IDs and validates untrusted model selections', async () => {
    const call = vi.fn(async () => ({ items: [] }));
    const controller = createController({ call, context: vi.fn(async () => undefined) });
    controller.receive({
      ...result(),
      selection: { project_id: project, audit_id: audit, view: 'sources', level: 'url' },
    });
    await controller.drill('https://publisher.example/a');
    expect(call).toHaveBeenCalledWith(
      'read_visibility_results',
      expect.objectContaining({ audit_id: audit, url: 'https://publisher.example/a' }),
    );
    act(() =>
      controller.receive({ ...result(), links: { ...links, application: 'javascript:alert(1)' } }),
    );
    expect(controller.getSnapshot().selection?.view).toBe('sources');
  });
});
