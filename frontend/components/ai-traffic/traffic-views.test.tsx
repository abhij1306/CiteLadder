import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vite-plus/test';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { TabsRoot } from '@/components/ui/tabs';
import { TrafficActivity, TrafficCrawlers } from './traffic-views';
import { TrafficSetupState } from './traffic-setup';

const project = makeProject({
  id: '88888888-8888-4888-8888-888888888888',
  workspace_id: '11111111-1111-4111-8111-111111111111',
  website_url: 'https://www.example.test',
});
const capability = vi.hoisted(() => ({ manage: true }));
vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({ activeProject: project, isLoading: false }),
  useOptionalProjectContext: () => ({ activeProjectId: project.id }),
  useWorkspaceCapability: (name: string) => name !== 'manage_credentials' || capability.manage,
  useActiveWorkspaceId: () => project.workspace_id,
}));
const root = '/api/v1/projects/' + project.id;

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  capability.manage = true;
});
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
  onClearFilters: () => {},
};

it('says the crawler catalog failed inside the activity table instead of showing raw bot ids', async () => {
  mswServer.use(
    http.get(root + '/crawl-logs/catalog', () => new HttpResponse(null, { status: 404 })),
    http.get(root + '/ai-traffic/activity', () =>
      HttpResponse.json({
        items: [
          activityRow('33333333-3333-4333-8333-333333333333', 'example.test', '/guide'),
          activityRow('66666666-6666-4666-8666-666666666666', 'cdn.other.test', '/guide'),
        ],
        next_cursor: null,
      }),
    ),
  );
  const view = renderWithProviders(
    <TabsRoot value="activity" onValueChange={() => {}}>
      <TrafficActivity {...scope} />
    </TabsRoot>,
    { projectSelection: { activeProject: project } },
  );
  const table = await screen.findByRole('region', { name: 'Retained automated request activity' });
  expect(await within(table).findByRole('alert')).toHaveTextContent('Not Found');
  expect(within(table).queryByText('openai_oai_searchbot')).not.toBeInTheDocument();

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
  expect((await within(table).findAllByRole('cell', { name: 'OAI-SearchBot' }))[0]).toBeVisible();
  expect(within(table).queryByRole('alert')).not.toBeInTheDocument();
  const paths = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[2]!.textContent);
  expect(paths).toEqual(['/guide', 'cdn.other.test/guide']);
});

function activityRow(id: string, host: string, path: string) {
  return {
    id,
    source_id: '44444444-4444-4444-8444-444444444444',
    batch_id: '55555555-5555-4555-8555-555555555555',
    occurred_at: '2026-10-01T00:00:00Z',
    host,
    display_path: path,
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
  };
}

function serveNoSources(tab: 'crawlers' | 'activity') {
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
}

it('does not let a role that may not manage credentials connect crawl logs', async () => {
  capability.manage = false;
  serveNoSources('crawlers');
  const view = renderWithProviders(<TrafficSetupState ga4Missing={false} crawlAvailable />);
  expect(await screen.findByRole('button', { name: 'Connect crawl logs' })).toBeDisabled();
  view.rerender(<TrafficSetupState ga4Missing crawlAvailable />);
  expect(screen.getByRole('button', { name: 'Connect crawl logs' })).toBeDisabled();
});

it.each([
  { ga4Missing: true, heading: 'Connect a traffic source' },
  { ga4Missing: false, heading: 'Connect crawl logs' },
])('connects crawl logs from the setup state (GA4 missing: $ga4Missing)', async (input) => {
  serveNoSources('crawlers');
  const user = userEvent.setup();
  renderWithProviders(<TrafficSetupState ga4Missing={input.ga4Missing} crawlAvailable />);
  expect(screen.getByRole('heading', { name: input.heading })).toBeVisible();
  const ga4 = screen.queryByRole('link', { name: 'Connect Google Analytics 4' });
  if (input.ga4Missing) expect(ga4?.getAttribute('href')).toMatch(/tab=referrals/);
  else expect(ga4).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
  expect(
    await within(screen.getByRole('dialog')).findByRole('radiogroup', {
      name: 'Collection method',
    }),
  ).toBeVisible();
});

it.each(['crawlers', 'activity'] as const)(
  'offers Clear filters when a narrowing empties %s, and says absence is an observation otherwise',
  async (tab) => {
    serveNoSources(tab);
    const onClearFilters = vi.fn();
    const table = (filters: Record<string, string>) => (
      <TabsRoot value={tab} onValueChange={() => {}}>
        {tab === 'crawlers' ? (
          <TrafficCrawlers {...scope} filters={filters} onClearFilters={onClearFilters} />
        ) : (
          <TrafficActivity {...scope} filters={filters} onClearFilters={onClearFilters} />
        )}
      </TabsRoot>
    );
    const user = userEvent.setup();
    const view = renderWithProviders(table({ range: '30d' }), {
      projectSelection: { activeProject: project },
    });
    expect(await screen.findByText(/No matching requests/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    view.rerender(table({ range: '30d', folder: '/blog' }));
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  },
);
