import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { prefetchRoute } from '@/lib/navigation/route-prefetch';
import { mswServer } from '@/test/msw-server';
import { createAppQueryClient } from './query-client';
import { INITIAL_VISIBILITY_PARAMS } from './visibility';
import { isMetricsPending, visibilityQueries } from './visibility-queries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID };
const PROJECTION = `/api/v1/projects/${PROJECT_ID}/visibility`;

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const notFound = (code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status: 404 });

/** Reads the landing selection the way the Visibility screen does, naming each state. */
function LandingProjection() {
  const query = useQuery(visibilityQueries.project(SCOPE, INITIAL_VISIBILITY_PARAMS));
  if (query.isPending) return <p>Loading</p>;
  if (isMetricsPending(query.error)) return <p>Being prepared</p>;
  if (query.isError) return <p>Failed</p>;
  return <p>{query.data === null ? 'Not measured' : 'Measured'}</p>;
}

function renderProjection(client = createAppQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <LandingProjection />
    </QueryClientProvider>,
  );
}

describe('the Visibility landing projection', () => {
  it('is asked for once when the route warmup found nothing measured yet', async () => {
    const asked: string[] = [];
    mswServer.use(
      http.get(`/api/v1/audits`, () => HttpResponse.json([])),
      http.get(PROJECTION, ({ request }) => {
        asked.push(new URL(request.url).search);
        return notFound('visibility_not_measured', 'No completed audit for project');
      }),
    );
    const client = createAppQueryClient();
    const { queryKey } = visibilityQueries.project(SCOPE, INITIAL_VISIBILITY_PARAMS);

    prefetchRoute(client, '/visibility', { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID });
    // The warmup's answer has landed before the screen mounts, as it does in the app.
    await vi.waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
    expect(client.getQueryState(queryKey)?.status).toBe('success');
    renderProjection(client);

    expect(await screen.findByText('Not measured')).toBeVisible();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(asked).toEqual(['?cohort=core&selection_mode=latest']);
  });

  it('keeps metrics still being written apart from nothing measured', async () => {
    mswServer.use(
      http.get(PROJECTION, () =>
        notFound('visibility_metrics_pending', 'Metrics not available for audit'),
      ),
    );
    renderProjection();

    expect(await screen.findByText('Being prepared')).toBeVisible();
  });

  it('reads a run that does not exist as a failure, never as nothing measured', async () => {
    mswServer.use(http.get(PROJECTION, () => notFound('not_found', 'Audit not found')));
    renderProjection();

    expect(await screen.findByText('Failed')).toBeVisible();
  });
});
