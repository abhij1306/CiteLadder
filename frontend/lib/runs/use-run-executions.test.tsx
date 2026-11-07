import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';

import { useRunExecutions } from './use-run-executions';

const RUN = '11111111-1111-4111-8111-111111111111';
const EXECUTION = '22222222-2222-4222-8222-222222222222';

const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function wrapper(client: QueryClient, workspaceId = WORKSPACE_A) {
  // A run page renders under the gate's project, scoped to its workspace.
  const project = makeProject({ workspace_id: workspaceId });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ActiveProjectScopeProvider project={project}>{children}</ActiveProjectScopeProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

const progress = (completed: number) => ({
  status: 'running' as const,
  completed_count: completed,
  failed_count: 0,
  updated_at: `2026-11-02T10:00:0${completed}Z`,
});

beforeAll(() => mswServer.listen());
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('useRunExecutions', () => {
  it('never shows a list read under another workspace from the shared cache', async () => {
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}/executions`, ({ request }) =>
        HttpResponse.json([
          {
            id: EXECUTION,
            prompt_index: 0,
            logical_engine: 'chatgpt',
            transport_provider: 'openai',
            status: 'succeeded',
            prompt_text: `asked in ${request.headers.get('x-workspace-id')}`,
            error_code: '',
            latency_ms: null,
          },
        ]),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const inA = renderHook(() => useRunExecutions(RUN, progress(0)), {
      wrapper: wrapper(client, WORKSPACE_A),
    });
    await waitFor(() =>
      expect(inA.result.current.data?.[0]?.prompt_text).toBe(`asked in ${WORKSPACE_A}`),
    );

    const inB = renderHook(() => useRunExecutions(RUN, progress(0)), {
      wrapper: wrapper(client, WORKSPACE_B),
    });
    expect(inB.result.current.data).toBeUndefined();
    await waitFor(() =>
      expect(inB.result.current.data?.[0]?.prompt_text).toBe(`asked in ${WORKSPACE_B}`),
    );
  });

  it('re-reads the executions only when the run’s progress moves', async () => {
    const statuses = ['running', 'succeeded'];
    let reads = 0;
    mswServer.use(
      http.get(`/api/v1/audits/${RUN}/executions`, () => {
        const status = statuses[Math.min(reads, statuses.length - 1)];
        reads += 1;
        return HttpResponse.json([
          {
            id: EXECUTION,
            prompt_index: 0,
            logical_engine: 'chatgpt',
            transport_provider: 'openai',
            status,
            prompt_text: 'Best plumber in Austin',
            error_code: '',
            latency_ms: null,
          },
        ]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ audit }) => useRunExecutions(RUN, audit), {
      wrapper: wrapper(client),
      initialProps: { audit: progress(0) },
    });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe('running'));

    // The audit poll returned the same progress: no list read.
    rerender({ audit: progress(0) });
    expect(reads).toBe(1);

    // One execution settled: the list is read once more and shows it.
    rerender({ audit: progress(1) });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe('succeeded'));
    expect(reads).toBe(2);
  });
});
