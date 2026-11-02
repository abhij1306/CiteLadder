import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vite-plus/test';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { TabsRoot } from '@/components/ui/tabs';
import { TrafficActivity, TrafficCrawlers } from './traffic-views';

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

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const catalog = {
  catalog_version: '1',
  bots: [],
  presets: {},
  max_batch_bytes: 2000,
  max_line_bytes: 1000,
  max_lines_per_batch: 10,
  upload_sample_lines: 50,
  max_backdate_days: 80,
  worker_timeout_ms: 5000,
};
const scope = {
  workspaceId: project.workspace_id,
  projectId: project.id,
  filters: { range: '30d' },
};

it('says the crawler catalog failed inside the activity table instead of showing raw bot ids', async () => {
  mswServer.use(
    http.get(root + '/crawl-logs/catalog', () => new HttpResponse(null, { status: 404 })),
    http.get(root + '/ai-traffic/activity', () =>
      HttpResponse.json({
        items: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            source_id: '44444444-4444-4444-8444-444444444444',
            batch_id: '55555555-5555-4555-8555-555555555555',
            occurred_at: '2026-10-01T00:00:00Z',
            host: 'example.test',
            display_path: '/guide',
            identity: 'exact',
            identity_reason: null,
            url_hash: null,
            folder: '/guide',
            resource_class: 'page',
            method: 'GET',
            status_code: 200,
            bot_id: 'openai_oai_searchbot',
            catalog_version: '1',
            verification: 'verified',
            verification_reason: null,
            verification_basis: null,
            ip_range_snapshot_id: null,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
  const view = renderWithProviders(
    <TabsRoot value="activity" onValueChange={() => {}}>
      <TrafficActivity {...scope} />
    </TabsRoot>,
  );
  const table = await screen.findByRole('table', { name: 'Retained automated request activity' });
  // The failure is the table's state, in the space the rows hold.
  expect(await within(table).findByRole('alert')).toHaveTextContent('Not Found');
  expect(within(table).queryByText('openai_oai_searchbot')).not.toBeInTheDocument();

  // Once the catalog answers, the same rows name their bot.
  mswServer.use(
    http.get(root + '/crawl-logs/catalog', () =>
      HttpResponse.json({
        ...catalog,
        bots: [
          {
            bot_id: 'openai_oai_searchbot',
            label: 'OAI-SearchBot',
            purpose: 'ai_search',
            ua_patterns: ['OAI-SearchBot'],
          },
        ],
      }),
    ),
  );
  await view.queryClient.refetchQueries({ predicate: (q) => q.queryKey.includes('catalog') });
  expect(await within(table).findByRole('cell', { name: 'OAI-SearchBot' })).toBeVisible();
  expect(within(table).queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['crawlers', 'activity'] as const)('offers crawl setup from empty %s', async (tab) => {
  mswServer.use(
    http.get(root + '/crawl-logs/catalog', () => HttpResponse.json(catalog)),
    http.get(root + '/crawl-logs/sources', () =>
      HttpResponse.json({
        availability: 'available',
        gcp_pull: {
          availability: 'available',
          reader_email: 'citeladder-log-reader@example.iam.gserviceaccount.com',
          log_filter: 'resource.type="http_load_balancer"',
          catalog_version: '2',
        },
        items: [],
      }),
    ),
    http.get(root + '/ai-traffic/' + tab, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  );
  const user = userEvent.setup();
  renderWithProviders(
    <TabsRoot value={tab} onValueChange={() => {}}>
      {tab === 'crawlers' ? <TrafficCrawlers {...scope} /> : <TrafficActivity {...scope} />}
    </TabsRoot>,
  );
  // The empty state sits inside the table, under its column headers.
  const table = await screen.findByRole('table');
  expect(await within(table).findByRole('heading', { name: /No matching requests/ })).toBeVisible();
  await user.click(await screen.findByRole('button', { name: 'Connect crawl logs' }));
  expect(
    await within(screen.getByRole('dialog')).findByRole('radiogroup', {
      name: 'Collection method',
    }),
  ).toBeVisible();
});
