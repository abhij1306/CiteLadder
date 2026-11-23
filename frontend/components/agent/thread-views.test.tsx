import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { agentViewHref } from '@/lib/agent/view-links';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ThreadViews } from './thread-views';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CRAWL = '33333333-3333-4333-8333-333333333333';
const MARKET = '44444444-4444-4444-8444-444444444444';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Agent thread views', () => {
  it('links each view to the screen that shows the same selection', () => {
    expect([
      agentViewHref({ kind: 'visibility_trend', market_id: MARKET, topic_id: null, range: '1y' }),
      agentViewHref({ kind: 'visibility_ranking', market_id: null, topic_id: null }),
      agentViewHref({ kind: 'visibility_sources', market_id: MARKET, topic_id: null }),
      agentViewHref({ kind: 'site_health_summary', crawl_id: CRAWL }),
      agentViewHref({ kind: 'ai_traffic_overview', range: '30d' }),
      agentViewHref({ kind: 'keyword_research_rows', dataset_id: CRAWL }, 'missing_keywords'),
      agentViewHref({ kind: 'keyword_research_rows', dataset_id: CRAWL }),
    ]).toEqual([
      `/insights?market=${MARKET}&range=1y`,
      '/competitors',
      `/visibility?tab=domains&market=${MARKET}`,
      `/site?crawl_id=${CRAWL}`,
      '/ai-traffic?tab=overview&range=30d',
      '/search-intelligence?tab=competitors',
      '/search-intelligence',
    ]);
  });

  it('shows a removed record as unavailable, not as a failed read to retry', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        HttpResponse.json({ detail: 'Crawl not found' }, { status: 404 }),
      ),
    );
    renderWithProviders(
      <ThreadViews
        scope={{ workspaceId: WORKSPACE, projectId: PROJECT }}
        views={[{ kind: 'site_health_summary', crawl_id: CRAWL }]}
      />,
      {
        projectSelection: {
          activeProjectId: PROJECT,
          activeProject: makeProject({ id: PROJECT }),
          status: 'ready',
        },
      },
    );
    expect(await screen.findByText(/This view is unavailable/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry/iu })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in app' })).toHaveAttribute(
      'href',
      `/site?crawl_id=${CRAWL}&project=${PROJECT}`,
    );
  });
});
