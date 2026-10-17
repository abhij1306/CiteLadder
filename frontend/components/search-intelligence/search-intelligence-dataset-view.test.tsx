import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vite-plus/test';

import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { SearchIntelligenceDatasetView } from './search-intelligence-dataset-view';
import * as csv from '@/lib/csv/download';
import { parseAgentHandoff } from '@/lib/agent/handoff';

const project = makeProject();
const dataset: SearchIntelligenceDataset = {
  id: 'a5df36ea-cb35-40f9-a7a9-a50ff7309cf1',
  run_id: '72dbc77c-676f-4bf7-8c29-16f163cb09f5',
  dataset_kind: 'ranking_keywords',
  target_domain: 'example.com',
  target_hostname: 'example.com',
  target_origin: 'https://example.com',
  research_scope: 'exact_host',
  acquisition: {},
  comparison_origin: '',
  location_code: 2840,
  language_code: 'en',
  status: 'published',
  coverage: 'complete',
  requested_rows: 201,
  raw_rows_received: 201,
  unique_rows_saved: 201,
  provider_total: 201,
  truncated: false,
  summary: {},
  collection_started_at: null,
  collection_ended_at: null,
  published_at: null,
};
function row(id: string, keyword: string) {
  return {
    id,
    dataset_id: dataset.id,
    call_id: null,
    row_kind: 'ranking_keywords',
    keyword,
    domain: '',
    url: '',
    search_volume: null,
    difficulty: null,
    intent: '',
    rank_group: null,
    owned_rank_group: null,
    etv: null,
    backlinks: null,
    referring_main_domains: null,
    dataforseo_rank: null,
    auxiliary: {},
  };
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => mswServer.close());

it('filters on the server and exports every saved matching page', async () => {
  const download = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
  const requests: URLSearchParams[] = [];
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        const filtered = params.get('search') === 'needle';
        const second = params.has('cursor');
        return HttpResponse.json({
          dataset: { ...dataset, filtered_saved_count: filtered ? 2 : 201 },
          rows: [
            row(
              second
                ? '55555555-5555-4555-8555-555555555555'
                : '44444444-4444-4444-8444-444444444444',
              filtered ? (second ? '=needle second' : 'needle first') : 'Unfiltered page',
            ),
          ],
          next_cursor: filtered && !second ? 'next-matching-page' : null,
        });
      },
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  await screen.findByText('Unfiltered page');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Filter saved results' }), 'needle');
  await screen.findByText('needle first');
  await userEvent.click(screen.getByRole('button', { name: 'Export saved CSV' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const exported = download.mock.calls[0]![2];
  expect(exported).toHaveLength(2);
  expect(exported[0]).toContain('needle first');
  expect(exported[1]).toContain('=needle second');
  expect(requests.at(-1)?.get('search')).toBe('needle');
});

it('hands the visible rows, or one selected row, to the Agent by id', async () => {
  const first = '44444444-4444-4444-8444-444444444444';
  const second = '55555555-5555-4555-8555-555555555555';
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({
        dataset,
        rows: [row(first, 'crm software'), row(second, 'crm pricing')],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  const handoff = (name: string) =>
    parseAgentHandoff(
      new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'http://x').searchParams,
    ).context.search_intelligence_reference;

  await screen.findByText('crm software');
  expect(handoff('Ask agent')).toEqual({ dataset_id: dataset.id, row_ids: [first, second] });
  await userEvent.click(screen.getByRole('button', { name: 'View evidence for crm pricing' }));
  expect(await screen.findByRole('link', { name: 'Ask agent about this row' })).toBeVisible();
  expect(handoff('Ask agent about this row')).toEqual({
    dataset_id: dataset.id,
    row_ids: [second],
  });
});

it.each([
  ['organic_pages', { organic_keywords: 22, etv: '7.5' }],
  [
    'backlinks',
    { dofollow: false, dataforseo_rank: 42, backlinks_spam_score: 0, anchor: 'Read more' },
  ],
  [
    'destination_pages',
    { referring_domains: 400, referring_main_domains: 250, dataforseo_rank: 34 },
  ],
  ['missing_keywords', { owned_rank_group: null, rank_group: 3, search_volume: 100 }],
  ['shared_keywords', { owned_rank_group: 5, rank_group: 2 }],
] as const)(
  'exports visible %s values without losing false, zero or unknown',
  async (kind, values) => {
    const download = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
    const snapshot = { ...dataset, dataset_kind: kind };
    mswServer.use(
      http.get(
        `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
        () =>
          HttpResponse.json({
            dataset: snapshot,
            rows: [{ ...row('33333333-3333-4333-8333-333333333333', 'Example'), ...values }],
            next_cursor: null,
          }),
      ),
    );
    renderWithProviders(<SearchIntelligenceDatasetView dataset={snapshot} />, {
      projectSelection: testProjectSelection({
        activeProject: project,
        activeProjectId: project.id,
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Export saved CSV' }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const [, headers, rows] = download.mock.calls[0]!;
    const exported = Object.fromEntries(headers.map((header, index) => [header, rows[0]![index]]));
    for (const [key, value] of Object.entries(values))
      expect(exported[key]).toBe(String(value ?? ''));
  },
);

it('rounds estimated traffic in the table and opens readable details from the keyword', async () => {
  const result = {
    ...row('33333333-3333-4333-8333-333333333333', 'Family outfits'),
    etv: '7.55999994',
    search_volume: 3600,
  };
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({ dataset, rows: [result], next_cursor: null }),
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByRole('cell', { name: '8' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '3,600' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'View evidence for Family outfits' }));
  const details = screen.getByRole('dialog', { name: 'Row details' });
  expect(within(details).getByText('3,600')).toBeInTheDocument();
  // Record identities stay out of what the reader sees.
  expect(details).not.toHaveTextContent(result.id);
  expect(details).not.toHaveTextContent(dataset.id);
});

it('links a missing keyword that became an Action', async () => {
  const actionId = '66666666-6666-4666-8666-666666666666';
  const missing = { ...dataset, dataset_kind: 'missing_keywords' };
  const tracked = {
    ...row('77777777-7777-4777-8777-777777777777', 'running shoes'),
    row_kind: 'missing_keywords',
    action_id: actionId,
  };
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({ dataset: missing, rows: [tracked], next_cursor: null }),
    ),
  );
  renderWithProviders(
    <SearchIntelligenceDatasetView dataset={missing} title="Missing keywords" />,
    {
      projectSelection: testProjectSelection({
        activeProject: project,
        activeProjectId: project.id,
      }),
    },
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'View evidence for running shoes' }),
  );
  expect(screen.getByRole('link', { name: 'Open Action' })).toHaveAttribute(
    'href',
    expect.stringContaining(`/agent/actions/${actionId}`),
  );
});

it('explains a paid empty scope', async () => {
  const empty = {
    ...dataset,
    dataset_kind: 'referring_domains',
    unique_rows_saved: 0,
    provider_total: 0,
  };
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({ dataset: empty, rows: [], next_cursor: null }),
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={empty} title="Referring domains" />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByText(/provider returned no data/i)).toBeInTheDocument();
});

it('uses shared pagination and resets its cursor when sorting or changing rows per page', async () => {
  const cursor = 'page+/=';
  const cursors: Array<string | null> = [];
  const requests: URLSearchParams[] = [];
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        cursors.push(params.get('cursor'));
        return HttpResponse.json({
          dataset,
          rows: [
            params.has('cursor')
              ? row('33333333-3333-4333-8333-333333333333', 'Later keyword')
              : row('44444444-4444-4444-8444-444444444444', 'First keyword'),
          ],
          next_cursor: params.has('cursor') ? null : cursor,
        });
      },
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });

  expect(await screen.findByText('First keyword')).toBeInTheDocument();
  expect(requests[0]?.get('limit')).toBe('10');
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('Later keyword')).toBeInTheDocument();
  expect(screen.queryByText('First keyword')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(cursors).toEqual([null, cursor]);
  await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));
  await waitFor(() => expect(requests.at(-1)?.get('sort')).toBe('keyword'));
  expect(requests.at(-1)?.has('cursor')).toBe(false);
  expect(await screen.findByRole('columnheader', { name: 'Keyword' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));
  await waitFor(() => expect(requests.at(-1)?.get('direction')).toBe('desc'));
  await userEvent.click(
    await screen.findByRole('combobox', { name: 'Rows per page for evidence rows' }),
  );
  await userEvent.click(await screen.findByRole('option', { name: '25' }));
  await waitFor(() => expect(requests.at(-1)?.get('limit')).toBe('25'));
  expect(requests.at(-1)?.has('cursor')).toBe(false);
});

it('hides a previous page while a different sort is pending', async () => {
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      async ({ request }) => {
        const sorted = new URL(request.url).searchParams.get('sort') === 'keyword';
        if (sorted) await delay(500);
        return HttpResponse.json({
          dataset,
          rows: [
            sorted
              ? row('55555555-5555-4555-8555-555555555555', 'Sorted keyword')
              : row('44444444-4444-4444-8444-444444444444', 'First keyword'),
          ],
          next_cursor: null,
        });
      },
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByText('First keyword')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));
  expect(screen.queryByText('First keyword')).not.toBeInTheDocument();
  expect(await screen.findByText('Sorted keyword')).toBeInTheDocument();
});

it('does not show a previous query page after a sort read fails', async () => {
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      ({ request }) =>
        new URL(request.url).searchParams.get('sort') === 'keyword'
          ? HttpResponse.json(
              { error: { code: 'unavailable', message: 'Read failed' } },
              { status: 503 },
            )
          : HttpResponse.json({
              dataset,
              rows: [row('44444444-4444-4444-8444-444444444444', 'First keyword')],
              next_cursor: null,
            }),
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByText('First keyword')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));
  expect(await screen.findByText('Read failed')).toBeInTheDocument();
  expect(screen.queryByText('First keyword')).not.toBeInTheDocument();
});

it('sends only nonnegative integer minimum volumes', async () => {
  const requests: URLSearchParams[] = [];
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          dataset,
          rows: [row('44444444-4444-4444-8444-444444444444', 'First keyword')],
          next_cursor: null,
        });
      },
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  await screen.findByText('First keyword');
  const input = screen.getByRole('spinbutton', { name: 'Minimum search volume' });
  fireEvent.change(input, { target: { value: '-1' } });
  fireEvent.change(input, { target: { value: '1.5' } });
  expect(input).toHaveValue(null);
  expect(requests).toHaveLength(1);
  fireEvent.change(input, { target: { value: '10' } });
  await waitFor(() => expect(requests.at(-1)?.get('min_volume')).toBe('10'));
});

it('removes saved rows when access to a dataset is revoked', async () => {
  mswServer.use(
    http.get(
      `/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`,
      ({ request }) =>
        new URL(request.url).searchParams.get('sort') === 'keyword'
          ? HttpResponse.json(
              { error: { code: 'forbidden', message: 'Access revoked' } },
              { status: 403 },
            )
          : HttpResponse.json({
              dataset,
              rows: [row('44444444-4444-4444-8444-444444444444', 'First keyword')],
              next_cursor: null,
            }),
    ),
  );
  renderWithProviders(<SearchIntelligenceDatasetView dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByText('First keyword')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));
  expect(await screen.findByText('Access revoked')).toBeInTheDocument();
  expect(screen.queryByText('First keyword')).not.toBeInTheDocument();
});
