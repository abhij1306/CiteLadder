import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { AiTrafficScreen } from './ai-traffic-screen';

const project = makeProject({
  id: '88888888-8888-4888-8888-888888888888',
  workspace_id: '11111111-1111-4111-8111-111111111111',
});
vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({ activeProject: project, isLoading: false }),
  useOptionalProjectContext: () => ({ activeProjectId: project.id }),
  useWorkspaceCapability: () => true,
  useActiveWorkspaceId: () => project.workspace_id,
}));
const root = '/api/v1/projects/' + project.id;
const overview = {
  crawl: {
    unit: 'requests',
    identity_level: 'path',
    connection: 'connected',
    coverage: 'partial',
    reporting_timezone: 'UTC',
    last_processed_at: null,
    requests: null,
    pages: null,
    active_bots: null,
    error_share: null,
    failed_verification_requests: null,
    series: [],
  },
  referrals: {
    project_id: project.id,
    window_start: null,
    window_end: null,
    granularity: 'day',
    referral_volume: [],
    referral_share: [],
    sources: [],
    analyzer_version: '1',
    formula_version: '1',
  },
  citations: {
    unit: 'tracked_citations',
    state: 'measured',
    count: 4,
    label: 'Tracked answers',
    sources: [{ audit_id: '99999999-9999-4999-8999-999999999999', analyzer_version: '1' }],
  },
};
const insights = {
  snapshot_id: null,
  window_start: '2026-10-01',
  window_end: '2026-10-04',
  formula_version: '1',
  patterns: [],
  coverage: { crawl: 'unknown', ga4_complete: false, notice: 'Referral coverage is partial' },
};
const sources = {
  availability: 'available',
  gcp_pull: {
    availability: 'available',
    reader_email: 'citeladder-log-reader@example.iam.gserviceaccount.com',
    log_filter: 'resource.type="http_load_balancer"',
    catalog_version: '2',
  },
  items: [],
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('AI Traffic opening requests', () => {
  it('asks for the overview and its insights while crawl availability is still being read', async () => {
    let answerSources!: () => void;
    const sourcesAnswered = new Promise<void>((resolve) => {
      answerSources = resolve;
    });
    const asked: string[] = [];
    mswServer.use(
      http.get(root + '/crawl-logs/sources', async () => {
        await sourcesAnswered;
        return HttpResponse.json(sources);
      }),
      http.get(root + '/ai-traffic/overview', ({ request }) => {
        asked.push('overview ' + new URL(request.url).search);
        return HttpResponse.json(overview);
      }),
      http.get(root + '/ai-traffic/insights', ({ request }) => {
        asked.push('insights ' + new URL(request.url).search);
        return HttpResponse.json(insights);
      }),
    );
    renderWithProviders(<AiTrafficScreen />, { projectSelection: { activeProject: project } });

    await waitFor(() =>
      expect(asked.sort()).toEqual(['insights ?range=30d', 'overview ?range=30d']),
    );
    // The loading frame draws the tab row, but no view is selected until
    // availability is known.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('Referral coverage is partial')).not.toBeInTheDocument();

    answerSources();
    expect(await screen.findByText('Referral coverage is partial')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(asked.sort()).toEqual(['insights ?range=30d', 'overview ?range=30d']);
  });
});
