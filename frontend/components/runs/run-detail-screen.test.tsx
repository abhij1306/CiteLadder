import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type { Audit } from '@citeladder/contracts';
import { queryKeys } from '@/lib/api/query-keys';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, selectionAs } from '@/test/render';
import { RunDetailScreen } from './run-detail-screen';

vi.mock('@/lib/runs/use-run-events', () => ({ useRunEvents: () => {} }));

const RUN = '00000001-1111-4111-8111-111111111111';

function audit(status: Audit['status']): Audit {
  return {
    id: RUN,
    workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project_id: '33333333-3333-4333-8333-333333333333',
    parent_audit_id: null,
    status,
    cancelable: status === 'running',
    benchmark_mode: 'consumer_like',
    audit_scope: 'commerce',
    model_provenance: [],
    repetitions: 1,
    random_seed: 'seed',
    requested_count: 10,
    completed_count: 4,
    failed_count: 0,
    error_message: '',
    engine_snapshots: [],
    market: { id: null, country_code: 'US', language_code: 'en' },
    launch_id: null,
    not_applicable_engines: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:01:00Z',
    started_at: '2026-08-01T00:00:01Z',
    completed_at: status === 'running' ? null : '2026-08-01T00:00:30Z',
  };
}

function ShelfReader({ onFetch }: Readonly<{ onFetch: () => void }>) {
  useQuery({
    queryKey: [...queryKeys.commerce.all, 'shelf-under-test'],
    queryFn: () => {
      onFetch();
      return { shelf: true };
    },
    staleTime: Infinity,
  });
  return null;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('RunDetailScreen', () => {
  it('refreshes Commerce reads once a cancelled run returns', async () => {
    let cancelled = false;
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}`, () =>
        HttpResponse.json(audit(cancelled ? 'cancelled' : 'running')),
      ),
      http.get(`/api/v1/audits/${RUN}/executions`, () => HttpResponse.json([])),
      http.post(`/api/v1/audits/${RUN}/cancel`, () => {
        cancelled = true;
        return HttpResponse.json(audit('cancelled'));
      }),
    );
    let shelfFetches = 0;
    renderWithProviders(
      <Routes>
        <Route
          path="/runs/:runId"
          element={
            <>
              <RunDetailScreen />
              <ShelfReader onFetch={() => shelfFetches++} />
            </>
          }
        />
      </Routes>,
      {
        initialEntries: [`/runs/${RUN}`],
        projectSelection: {
          activeProject: makeProject({ id: '33333333-3333-4333-8333-333333333333' }),
        },
      },
    );
    await waitFor(() => expect(shelfFetches).toBe(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(shelfFetches).toBe(2));
  });

  it('lets a viewer follow and export a running run without offering to cancel it', async () => {
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}`, () => HttpResponse.json(audit('running'))),
      http.get(`/api/v1/audits/${RUN}/executions`, () => HttpResponse.json([])),
    );
    renderWithProviders(
      <Routes>
        <Route path="/runs/:runId" element={<RunDetailScreen />} />
      </Routes>,
      {
        initialEntries: [`/runs/${RUN}`],
        projectSelection: {
          ...selectionAs('viewer'),
          activeProject: makeProject({ id: '33333333-3333-4333-8333-333333333333' }),
        },
      },
    );

    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Commerce audit · Aug 1, 2026',
    );
  });

  it('names a failed run read once, without a second failure for its executions', async () => {
    const failure = () => HttpResponse.json({ error: { message: 'down' } }, { status: 500 });
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}`, failure),
      http.get(`/api/v1/audits/${RUN}/executions`, failure),
    );
    renderWithProviders(
      <Routes>
        <Route path="/runs/:runId" element={<RunDetailScreen />} />
      </Routes>,
      {
        initialEntries: [`/runs/${RUN}`],
        projectSelection: {
          activeProject: makeProject({ id: '33333333-3333-4333-8333-333333333333' }),
        },
      },
    );

    expect(await screen.findByText("Couldn't load this run")).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Retry/ })).toHaveLength(1);
    expect(screen.queryByText("Couldn't load the executions")).toBeNull();
  });

  it('keeps executions that loaded when only the run read failed', async () => {
    const answered = {
      id: '11111111-1111-4111-8111-000000000001',
      prompt_index: 0,
      logical_engine: 'gemini',
      transport_provider: 'google',
      status: 'succeeded',
      prompt_text: 'Best trail running shoes',
      error_code: '',
      latency_ms: 1200,
    };
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}`, () =>
        HttpResponse.json({ error: { message: 'down' } }, { status: 500 }),
      ),
      http.get(`/api/v1/audits/${RUN}/executions`, () => HttpResponse.json([answered])),
    );
    renderWithProviders(
      <Routes>
        <Route path="/runs/:runId" element={<RunDetailScreen />} />
      </Routes>,
      {
        initialEntries: [`/runs/${RUN}`],
        projectSelection: {
          activeProject: makeProject({ id: '33333333-3333-4333-8333-333333333333' }),
        },
      },
    );

    expect(await screen.findByText("Couldn't load this run")).toBeVisible();
    expect(await screen.findByText('Best trail running shoes')).toBeVisible();
  });
});
