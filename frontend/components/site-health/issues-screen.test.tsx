import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeProject } from '@/test/fixtures/project';
import { makeSiteCrawl } from '@/test/fixtures/site-health';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { queryKeys } from '@/lib/api/query-keys';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '22222222-2222-4222-8222-222222222222';
const activeProject = makeProject({ id: PROJECT, workspace_id: WORKSPACE });

vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({
    activeProject,
    activeWorkspaceId: WORKSPACE,
    isLoading: false,
  }),
}));

vi.mock('@/components/site-health/issues-catalog', () => ({
  // The catalog now carries a refresh failure itself, so the stub has to render
  // the notice it is handed — the screen no longer draws one beside it.
  IssuesCatalog: ({
    workspaceId,
    crawlId,
    notice,
  }: {
    workspaceId: string;
    crawlId: string;
    notice?: React.ReactNode;
  }) => (
    <div>
      {notice}
      <div data-testid="issues-catalog">{`${workspaceId}:${crawlId}`}</div>
    </div>
  ),
}));

import { IssuesScreen } from './issues-screen';

const dashboard = {
  project_id: PROJECT,
  crawl: makeSiteCrawl({
    id: CRAWL,
    workspace_id: WORKSPACE,
    project_id: PROJECT,
  }),
  score_summary: null,
  phase: 'dashboard',
  snapshot_id: null,
  quota: { used: 1, limit: 50 },
  root_errors: [],
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('IssuesScreen read recovery', () => {
  it('retries an initial dashboard failure without starting a crawl', async () => {
    const user = userEvent.setup();
    let available = false;
    let reads = 0;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () => {
        reads += 1;
        return available
          ? HttpResponse.json(dashboard)
          : HttpResponse.json(
              { error: { message: 'Site Health is temporarily unavailable' } },
              { status: 404 },
            );
      }),
    );

    renderWithProviders(<IssuesScreen />);

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByTestId('issues-catalog')).not.toBeInTheDocument();
    available = true;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('issues-catalog')).toHaveTextContent(`${WORKSPACE}:${CRAWL}`);
    expect(reads).toBe(2);
  });

  it('retains the exact crawl catalog when a same-scope refresh fails', async () => {
    let available = true;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        available
          ? HttpResponse.json(dashboard)
          : HttpResponse.json({ error: { message: 'Refresh failed' } }, { status: 404 }),
      ),
    );

    const { queryClient } = renderWithProviders(<IssuesScreen />);
    expect(await screen.findByTestId('issues-catalog')).toHaveTextContent(`${WORKSPACE}:${CRAWL}`);

    available = false;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.siteHealth.dashboard(PROJECT),
    });

    expect(await screen.findByText('Refresh failed')).toBeVisible();
    expect(screen.getByTestId('issues-catalog')).toHaveTextContent(`${WORKSPACE}:${CRAWL}`);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled());
  });
});
