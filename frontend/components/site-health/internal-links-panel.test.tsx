import { http, HttpResponse } from 'msw';
import { screen, within, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { downloadCsv } from '@/lib/csv/download';
import { InternalLinksPanel } from './internal-links-panel';

vi.mock('@/lib/csv/download', () => ({ downloadCsv: vi.fn() }));

const project = makeProject();
const run = '00000000-0000-4000-8000-000000000011';
const crawl = '00000000-0000-4000-8000-000000000012';
const endpoint = `/api/v1/projects/${project.id}/site-health/internal-links`;
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function page(index: number, title: string) {
  const id = uuid(100 + index);
  return {
    analysis_id: id,
    artifact_id: id,
    site_url_id: id,
    url: `https://example.test/page-${index}`,
    title,
    h1: title,
    description: `${title} description.`,
    excerpt: '',
    page_kind: 'category',
    contextual_inbound: 2,
    links_complete: true,
    eligible_target: true,
    extractor_version: '1',
  };
}
function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: run,
    crawl_id: crawl,
    created_at: '2026-09-28T10:00:00Z',
    state: 'completed',
    page_count: 20,
    omitted_pages: 0,
    stale: false,
    recommendations: [],
    diagnostics: {
      candidates: 30,
      completed: 30,
      pending: 0,
      unavailable: 0,
      below_threshold: 30,
      reasons: {},
      elapsed_seconds: 12,
    },
    ...overrides,
  };
}
const read = (value: unknown) => ({
  history: [],
  crawl_id: crawl,
  availability: 'ready',
  analysis: value,
});
function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>Back</button>
      <output aria-label="Location">{location.pathname + location.search}</output>
    </>
  );
}

function renderPanel(withNavigation = false) {
  return renderWithProviders(
    <>
      <InternalLinksPanel projectId={project.id} workspaceId={project.workspace_id} />
      {withNavigation ? <Navigation /> : null}
    </>,
    {
      initialEntries: [
        ...(withNavigation ? ['/projects'] : []),
        `/site?tab=internal-links&project=${project.id}`,
      ],
      projectSelection: { activeProject: project, activeProjectId: project.id, status: 'ready' },
    },
  );
}
beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Internal links', () => {
  it('starts queued analysis immediately while keeping progress and cancellation responsive', async () => {
    let admitted = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execution = vi.fn();
    const queued = read(analysis({ state: 'queued' }));
    mswServer.use(
      http.get(endpoint, () => HttpResponse.json(admitted ? queued : read(null))),
      http.post(`${endpoint}/analyses`, () => {
        admitted = true;
        return HttpResponse.json(queued);
      }),
      http.post(`${endpoint}/analyses/${run}/run`, async ({ request }) => {
        execution(request.headers.get('x-workspace-id'));
        await pending;
        return HttpResponse.json(queued);
      }),
    );
    renderPanel();
    const start = await screen.findByRole('button', { name: 'Analyze internal links' });
    expect(execution).not.toHaveBeenCalled();
    try {
      await userEvent.click(start);
      await waitFor(() => expect(execution).toHaveBeenCalledWith(project.workspace_id));
      expect(await screen.findByRole('button', { name: /cancel/i })).toBeEnabled();
    } finally {
      release();
    }
  });
  it('refreshes the default analysis after a rerun when navigating Back', async () => {
    const previous = analysis({ page_count: 20 });
    const next = analysis({ id: uuid(22), page_count: 42 });
    let latest = previous;
    mswServer.use(
      http.get(endpoint, () => HttpResponse.json(read(latest))),
      http.post(`${endpoint}/analyses`, () => {
        latest = next;
        return HttpResponse.json(read(next));
      }),
    );
    renderPanel(true);
    expect(await screen.findByText(/20 pages/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze again' }));
    expect(await screen.findByText(/42 pages/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Location')).not.toHaveTextContent('analysis='),
    );
    expect(await screen.findByText(/42 pages/)).toBeInTheDocument();
  });

  it('replaces search history while preserving deliberate analysis navigation', async () => {
    const link = {
      id: uuid(200),
      source: page(0, 'Source'),
      target: page(1, 'Destination'),
      anchor: 'Anchor',
      placement: null,
      usefulness: 0.9,
      action_id: null,
      action_status: null,
    };
    mswServer.use(
      http.get(endpoint, () => HttpResponse.json(read(analysis({ recommendations: [link] })))),
    );
    renderPanel(true);
    const search = await screen.findByRole('searchbox', { name: 'Search pages and anchors' });
    await userEvent.type(search, 'Anchor');
    expect(screen.getByLabelText('Location')).toHaveTextContent('links_q=Anchor');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Location').textContent).toBe('/projects');
  });
  it('runs only on request and reports unavailable checks instead of an empty result', async () => {
    const failed = analysis({
      state: 'unavailable',
      diagnostics: {
        ...analysis().diagnostics,
        completed: 0,
        below_threshold: 0,
        unavailable: 30,
        reasons: { provider_unconfigured: 30 },
      },
    });
    let analyzed = false;
    mswServer.use(
      http.get(endpoint, () => HttpResponse.json(read(analyzed ? failed : null))),
      http.post(`${endpoint}/analyses`, () => {
        analyzed = true;
        return HttpResponse.json(read(failed));
      }),
    );
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Analyze internal links' }));
    expect(await screen.findByText(/analysis provider not configured \(30\)/)).toBeInTheDocument();
    expect(screen.queryByText(/none needed a new link/)).not.toBeInTheDocument();
  });

  it('tells "nothing to compare" apart from "checked and nothing qualified"', async () => {
    mswServer.use(http.get(endpoint, () => HttpResponse.json(read(analysis()))));
    renderPanel();
    expect(
      await screen.findByText(
        '30 page pairs were checked and none qualified for a contextual link.',
      ),
    ).toBeInTheDocument();
  });

  it('pages suggestions with rows per page and opens the review drawer', async () => {
    const links = Array.from({ length: 12 }, (_, index) => ({
      id: uuid(200 + index),
      source: page(index, `Source ${index}`),
      target: page(50 + index, `Destination ${index}`),
      anchor: `Anchor ${index}`,
      placement: {
        text: `Consider Anchor ${index} when preparing this page for publication.`,
        anchor: `Anchor ${index}`,
        anchor_start: 9,
        start: 400,
        end: 400 + `Consider Anchor ${index} when preparing this page for publication.`.length,
      },
      usefulness: 0.9 - index / 100,
      action_id: null,
      action_status: null,
    }));
    mswServer.use(
      http.get(endpoint, () => HttpResponse.json(read(analysis({ recommendations: links })))),
    );
    renderPanel();
    expect(await screen.findByText('Anchor 0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith(
      'internal-links',
      expect.arrayContaining([
        'Source analysis ID',
        'Source artifact ID',
        'Source site URL ID',
        'Source extractor version',
      ]),
      expect.arrayContaining([
        [
          links[0]!.source.url,
          links[0]!.target.url,
          links[0]!.anchor,
          links[0]!.placement.text,
          links[0]!.source.analysis_id,
          links[0]!.source.artifact_id,
          links[0]!.source.site_url_id,
          links[0]!.source.extractor_version,
        ],
      ]),
    );
    expect(screen.queryByText('Anchor 11')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Anchor 11')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Review link from Source 11 to Destination 11' }),
    );
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/when preparing this page for publication/)).toHaveTextContent(
      'Consider Anchor 11 when preparing this page for publication.',
    );
    expect(within(drawer).getByRole('button', { name: /Copy HTML/ })).toBeInTheDocument();
  });

  it('distinguishes failed analysis and unknown diagnostic reasons', async () => {
    mswServer.use(
      http.get(endpoint, () =>
        HttpResponse.json(
          read(
            analysis({
              state: 'failed',
              diagnostics: {
                ...analysis().diagnostics,
                reasons: { unexpected_provider_state: 1 },
              },
            }),
          ),
        ),
      ),
    );
    renderPanel();
    expect(
      await screen.findByText(/This analysis failed: unknown reason: unexpected_provider_state/),
    ).toBeInTheDocument();
  });
});
