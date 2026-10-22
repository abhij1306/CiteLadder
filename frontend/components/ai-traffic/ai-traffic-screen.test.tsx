import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { AiTrafficScreen } from './ai-traffic-screen';
import { CrawlSignalPanel } from './overview-signals';
import { InsightStrip } from './insight-strip';
import { CrawlLogConnections } from './crawl-log-connections';
import { TrafficCrawlers, TrafficActivity } from './traffic-views';
import { TabsRoot } from '@/components/ui/tabs';
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
const crawl = {
  unit: 'requests' as const,
  identity_level: 'path' as const,
  connection: 'connected' as const,
  coverage: 'partial' as const,
  reporting_timezone: 'UTC',
  last_processed_at: null,
  requests: null,
  pages: null,
  active_bots: null,
  error_share: null,
  failed_verification_requests: null,
  series: [],
};
const referrals = {
  project_id: project.id,
  window_start: '',
  window_end: '',
  granularity: 'day',
  referral_volume: [],
  referral_share: [],
  sources: [],
  analyzer_version: '1',
  formula_version: '1',
};
/** A source-list response: the GCP connector configured and sources without pull details. */
const sourceBody = (availability: string, items: Record<string, unknown>[] = []) => ({
  availability,
  gcp_pull: {
    availability: 'available',
    reader_email: 'citeladder-log-reader@example.iam.gserviceaccount.com',
    log_filter: 'resource.type="http_load_balancer"',
    catalog_version: '2',
  },
  items: items.map((item) => ({ pull: null, ...item })),
});
beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  window.history.replaceState(null, '', '/ai-traffic');
});
afterAll(() => mswServer.close());
describe('AI Traffic state and navigation', () => {
  it('says collection is paused when CiteLadder switched it off', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('disabled'))),
    );
    renderWithProviders(<CrawlLogConnections />);
    expect(await screen.findByText(/Collection is paused on this server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
  });
  it('shows why a live source is stalled on its row', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(
          sourceBody('available', [
            {
              id: '99999999-9999-4999-8999-999999999999',
              kind: 'webhook',
              setup: 'custom',
              preset: 'custom_ndjson',
              buffer_interval_seconds: null,
              format: 'ndjson',
              collection_point: 'application',
              sampling: { kind: 'none' },
              origin: 'https://example.test',
              host: 'example.test',
              status: 'active',
              state: 'stalled',
              stall_reason: 'oversize',
              stalled_at: '2026-10-10T00:00:00.000Z',
              token_prefix: 'clw_abcdefgh',
              connection: 'connected',
              last_accepted_batch: '2026-10-09T00:00:00.000Z',
              last_processed_at: null,
              rejected_lines: 0,
              overlapping_lines: 0,
              unsupported_uploads: 0,
              unsupported_batches: 0,
            },
          ]),
        ),
      ),
    );
    renderWithProviders(<CrawlLogConnections />);
    expect(await screen.findByText(/Custom webhook · Connected · Stalled/)).toBeVisible();
    expect(
      screen.getByText('A batch over 5 MiB was dropped. Lower the stream buffer size.'),
    ).toBeVisible();
  });
  it('shows the Firehose endpoint for a rotated Amazon CloudFront token', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(
          sourceBody('available', [
            {
              id,
              kind: 'webhook',
              setup: 'aws_firehose',
              preset: 'cloudfront_v2_json',
              buffer_interval_seconds: 60,
              format: 'ndjson',
              collection_point: 'cdn_edge',
              sampling: { kind: 'none' },
              origin: 'https://example.test',
              host: 'example.test',
              status: 'active',
              state: 'active',
              stall_reason: null,
              stalled_at: null,
              token_prefix: 'clw_abcdefgh',
              connection: 'connected',
              last_accepted_batch: null,
              last_processed_at: null,
              rejected_lines: 0,
              overlapping_lines: 0,
              unsupported_uploads: 0,
              unsupported_batches: 0,
            },
          ]),
        ),
      ),
      http.post(root + '/crawl-logs/sources/' + id + '/rotate', () =>
        HttpResponse.json({ id, token: 'clw_rotated' }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(await screen.findByRole('button', { name: 'Rotate token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect crawl logs' });
    expect(
      await within(dialog).findByText(new RegExp('/v1/crawl-logs/firehose/' + id)),
    ).toBeVisible();
  });
  it('keeps setup unavailable on a failed availability read and recovers on retry', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => new HttpResponse(null, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = screen.getByRole('dialog');
    // The production query policy exhausts its automatic 5xx retries first.
    const retry = await within(dialog).findByRole('button', { name: /retry/i }, { timeout: 5000 });
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
    );
    await user.click(retry);
    expect(
      await within(dialog).findByRole('radiogroup', { name: 'Collection method' }),
    ).toBeVisible();
  });
  it('guides first upload through source creation and selects the created source', async () => {
    let created = false;
    const id = '99999999-9999-4999-8999-999999999999';
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(
          sourceBody(
            'available',
            created
              ? [
                  {
                    id,
                    kind: 'upload',
                    setup: 'upload',
                    preset: 'custom_ndjson',
                    buffer_interval_seconds: null,
                    format: 'ndjson',
                    collection_point: 'uploaded_file',
                    sampling: { kind: 'none' },
                    origin: 'https://example.test',
                    host: 'example.test',
                    status: 'active',
                    state: 'active',
                    stall_reason: null,
                    stalled_at: null,
                    token_prefix: null,
                    connection: 'awaiting_data',
                    last_accepted_batch: null,
                    last_processed_at: null,
                    rejected_lines: 0,
                    overlapping_lines: 0,
                    unsupported_uploads: 0,
                    unsupported_batches: 0,
                  },
                ]
              : [],
          ),
        ),
      ),
      http.post(root + '/crawl-logs/sources', async ({ request }) => {
        expect(await request.json()).toMatchObject({
          setup: 'upload',
          collection_point: 'uploaded_file',
        });
        created = true;
        return HttpResponse.json({ id, token: null });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    await user.click(await screen.findByRole('radio', { name: /Upload file/ }));
    expect(screen.getByText(/First, create an upload source/)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Upload source' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create source' }));
    expect(await screen.findByRole('combobox', { name: 'Upload source' })).toHaveTextContent(
      'example.test',
    );
    await user.upload(screen.getByLabelText('Log file'), new File(['{}'], 'requests.ndjson'));
    expect(screen.getByRole('button', { name: 'Upload recognized requests' })).toBeEnabled();
  });
  it.each(['crawlers', 'activity'] as const)('offers crawl setup from empty %s', async (tab) => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
    );
    const user = userEvent.setup();
    const data = { items: [], next_cursor: null };
    renderWithProviders(
      <TabsRoot value={tab} onValueChange={() => {}}>
        {tab === 'crawlers' ? <TrafficCrawlers data={data} /> : <TrafficActivity data={data} />}
      </TabsRoot>,
    );
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    expect(
      await within(screen.getByRole('dialog')).findByRole('radiogroup', {
        name: 'Collection method',
      }),
    ).toBeVisible();
  });
  it.each([null, 'Coverage is incomplete.'])(
    'retains only meaningful empty insights (%s)',
    async (notice) => {
      mswServer.use(
        http.get(root + '/ai-traffic/insights', () =>
          HttpResponse.json({
            snapshot_id: null,
            window_start: '2026-10-01',
            window_end: '2026-10-04',
            formula_version: '1',
            patterns: [],
            coverage: { crawl: 'partial', ga4_complete: false, notice },
          }),
        ),
      );
      renderWithProviders(
        <InsightStrip projectId={project.id} workspaceId={project.workspace_id} range="30d" />,
      );
      await waitFor(() =>
        expect(screen.queryByText('Loading persisted insights…')).not.toBeInTheDocument(),
      );
      if (notice) expect(screen.getByText(notice)).toBeVisible();
      else expect(screen.queryByText('Observed patterns')).not.toBeInTheDocument();
    },
  );
  it('creates an Amazon CloudFront source with its buffer interval and shows the Firehose endpoint', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    let created: unknown = null;
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
      http.post(root + '/crawl-logs/sources', async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ id, token: 'clw_test_token' });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect crawl logs' });
    await user.click(within(dialog).getByRole('radio', { name: /Amazon CloudFront/ }));
    expect(
      within(dialog).getByText(/In us-east-1, create an Amazon Data Firehose stream/),
    ).toBeVisible();
    expect(within(dialog).queryByRole('combobox', { name: 'Sampling' })).not.toBeInTheDocument();
    const interval = within(dialog).getByLabelText('Firehose buffer interval (seconds)');
    await user.clear(interval);
    await user.type(interval, '300');
    await user.click(within(dialog).getByRole('button', { name: 'Create source' }));
    expect(await within(dialog).findByText(/\/v1\/crawl-logs\/firehose\/9{8}-/)).toBeVisible();
    expect(created).toEqual({
      setup: 'aws_firehose',
      origin: 'https://acme.com',
      buffer_interval_seconds: 300,
      declared_filtered: false,
    });
  });
  it('creates a Google Cloud source, shows its labelled commands and verifies the subscription', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    let created: unknown = null;
    let verified = false;
    const pullSource = () => ({
      id,
      kind: 'pull',
      setup: 'gcp_pubsub_pull',
      preset: 'gcp_log_entry',
      buffer_interval_seconds: null,
      format: 'ndjson',
      collection_point: 'cdn_edge',
      sampling: { kind: 'none' },
      origin: 'https://acme.com',
      host: 'acme.com',
      status: 'active',
      state: verified ? 'active' : 'awaiting_verification',
      stall_reason: null,
      stalled_at: null,
      token_prefix: null,
      connection: 'awaiting_data',
      last_accepted_batch: null,
      last_processed_at: null,
      rejected_lines: 0,
      overlapping_lines: 0,
      unsupported_uploads: 0,
      unsupported_batches: 0,
      pull: {
        subscription: 'projects/acme-prod/subscriptions/crawlers-sub',
        verification_nonce: 'abcdefghijklmnopqrstuvwxyz',
        verified_at: verified ? '2026-10-10T00:00:00.000Z' : null,
        verification_checked_at: null,
        verification_failure: null,
        filter_catalog_version: '2',
        filter_confirmed_at: null,
        filter_current: true,
        declared_sample_rate: 1,
        last_pull_at: null,
        last_drained_at: null,
      },
    });
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(sourceBody('available', created ? [pullSource()] : [])),
      ),
      http.post(root + '/crawl-logs/sources', async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ id, token: null });
      }),
      http.post(root + '/crawl-logs/sources/' + id + '/verify', () => {
        verified = true;
        return HttpResponse.json({ id, verified: true, failure: null });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect crawl logs' });
    await user.click(within(dialog).getByRole('radio', { name: /Google Cloud/ }));
    await user.type(
      within(dialog).getByLabelText('Pub/Sub subscription'),
      'projects/acme-prod/subscriptions/crawlers-sub',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create source' }));
    expect(
      await within(dialog).findByText(/--labels=citeladder-source=abcdefghijklmnopqrstuvwxyz/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        /add-iam-policy-binding crawlers-sub --project=acme-prod --member=serviceAccount:citeladder-log-reader@example\.iam\.gserviceaccount\.com --role=roles\/pubsub\.subscriber/,
      ),
    ).toBeVisible();
    expect(created).toEqual({
      setup: 'gcp_pubsub_pull',
      origin: 'https://acme.com',
      subscription: 'projects/acme-prod/subscriptions/crawlers-sub',
      declared_sample_rate: 1,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Verify subscription' }));
    expect(await within(dialog).findByText(/^Verified\./)).toBeVisible();
    expect(await screen.findByText(/Google Cloud · Awaiting data · Active/)).toBeVisible();
  });
  it('disables the Google Cloud option where no reader service account is configured', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json({
          ...sourceBody('available'),
          gcp_pull: {
            availability: 'pull_unavailable',
            reader_email: null,
            log_filter: 'resource.type="http_load_balancer"',
            catalog_version: '2',
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect crawl logs' });
    const option = await within(dialog).findByRole('radio', { name: /Google Cloud/ });
    expect(option).toBeDisabled();
    expect(within(dialog).getByText('Not available in this environment.')).toBeVisible();
  });
  it('asks for the new sink filter after a catalog change and records the confirmation', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    let confirmed = false;
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(
          sourceBody('available', [
            {
              id,
              kind: 'pull',
              setup: 'gcp_pubsub_pull',
              preset: 'gcp_log_entry',
              buffer_interval_seconds: null,
              format: 'ndjson',
              collection_point: 'cdn_edge',
              sampling: { kind: 'none' },
              origin: 'https://acme.com',
              host: 'acme.com',
              status: 'active',
              state: 'stalled',
              stall_reason: 'verification_failed',
              stalled_at: '2026-10-10T00:00:00.000Z',
              token_prefix: null,
              connection: 'connected',
              last_accepted_batch: null,
              last_processed_at: null,
              rejected_lines: 0,
              overlapping_lines: 0,
              unsupported_uploads: 0,
              unsupported_batches: 0,
              pull: {
                subscription: 'projects/acme-prod/subscriptions/crawlers-sub',
                verification_nonce: 'abcdefghijklmnopqrstuvwxyz',
                verified_at: '2026-10-01T00:00:00.000Z',
                verification_checked_at: '2026-10-10T00:00:00.000Z',
                verification_failure: 'permission_denied',
                filter_catalog_version: '1',
                filter_confirmed_at: null,
                filter_current: confirmed,
                declared_sample_rate: 1,
                last_pull_at: null,
                last_drained_at: '2026-10-09T00:00:00.000Z',
              },
            },
          ]),
        ),
      ),
      http.post(root + '/crawl-logs/sources/' + id + '/filter-confirmation', () => {
        confirmed = true;
        return HttpResponse.json({ id });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    expect(
      await screen.findByText(
        /The subscription failed its check\. Fix it, then verify again\. CiteLadder’s reader lacks subscriber and viewer roles/,
      ),
    ).toBeVisible();
    const prompt = screen.getByRole('region', { name: 'Sink filter update for acme.com' });
    expect(within(prompt).getByText('resource.type="http_load_balancer"')).toBeVisible();
    await user.click(within(prompt).getByRole('button', { name: 'I’ve updated it' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Sink filter update for acme.com' }),
      ).not.toBeInTheDocument(),
    );
    expect(confirmed).toBe(true);
  });
  it('preserves the issued token until the source dialog is closed', async () => {
    let creates = 0;
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
      http.post(root + '/crawl-logs/sources', () => {
        creates += 1;
        return HttpResponse.json({
          id: '99999999-9999-4999-8999-999999999999',
          token: 'clw_test_token',
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect crawl logs' });
    const create = within(dialog).getByRole('button', { name: 'Create source' });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    await within(dialog).findByRole('button', { name: 'Copy token' });
    await waitFor(() => expect(create).not.toHaveAttribute('aria-busy'));
    expect(create).toBeDisabled();
    await user.click(create);
    expect(creates).toBe(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    expect(screen.getByRole('button', { name: 'Create source' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Copy token' })).not.toBeInTheDocument();
  });
  it('carries the insight project and filters into the Pages destination', async () => {
    mswServer.use(
      http.get(root + '/ai-traffic/insights', () =>
        HttpResponse.json({
          snapshot_id: 'saved',
          window_start: '2026-10-01',
          window_end: '2026-10-04',
          formula_version: '1',
          patterns: [
            {
              pattern: 'key_event_concentration',
              copy: 'Key events co-occurred on these pages.',
              url_hashes: [],
              numbers: { key_events: 10 },
              coverage: { ga4: 'complete' },
            },
          ],
          coverage: { crawl: 'complete', ga4_complete: true, notice: null },
        }),
      ),
    );
    renderWithProviders(
      <InsightStrip projectId={project.id} workspaceId={project.workspace_id} range="90d" />,
    );
    const link = await screen.findByRole('link', { name: /Inspect pages/ });
    const destination = new URL(link.getAttribute('href')!, window.location.origin);
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      project: project.id,
      tab: 'pages',
      range: '90d',
      sort: 'key_events_desc',
      pattern: 'key_event_concentration',
    });
  });
  it('keeps unavailable, missing, awaiting, incomplete and measured zero distinct', () => {
    const view = renderWithProviders(
      <CrawlSignalPanel available={false} data={{ ...crawl, connection: 'not_connected' }} />,
    );
    expect(screen.getByText(/not available for this workspace yet/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
    view.rerender(<CrawlSignalPanel available data={{ ...crawl, connection: 'not_connected' }} />);
    expect(screen.getByRole('button', { name: 'Connect crawl logs' })).toBeEnabled();
    view.rerender(<CrawlSignalPanel available data={{ ...crawl, connection: 'awaiting_data' }} />);
    expect(screen.getByText(/Awaiting the first accepted batch/)).toBeVisible();
    view.rerender(<CrawlSignalPanel available data={crawl} />);
    expect(screen.getByText(/No matching requests were observed/)).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    view.rerender(
      <CrawlSignalPanel
        available
        data={{ ...crawl, coverage: 'complete', requests: 0, pages: 0, active_bots: 0 }}
      />,
    );
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.queryByText(/No matching requests were observed/)).not.toBeInTheDocument();
  });
  it('persists tab selection, renders accessible activity and exports the selected filters', async () => {
    let exportStatus: string | null = null;
    const exportedPages = { value: null as URLSearchParams | null };
    const page = {
      url_hash: 'a'.repeat(64),
      canonical_url: 'https://example.test/page',
      display_path: '/page',
      folder: '/page',
      resource_class: 'page',
      crawl: { state: 'zero', value: 0, coverage: 'complete', reason: null },
      referrals: { state: 'flagged', value: null, coverage: 'partial', reason: 'thresholding' },
      citations: { state: 'not_connected', value: null, coverage: null, reason: null },
      findings: {
        state: 'unavailable',
        value: null,
        coverage: null,
        reason: 'incomplete_coverage',
      },
      key_events: null,
      errors_4xx: 0,
      errors_5xx: 0,
      last_crawl: null,
    };
    mswServer.use(
      http.get(root + '/ai-traffic/overview', () =>
        HttpResponse.json({
          crawl,
          referrals,
          citations: { unit: 'tracked_citations', count: null, label: 'Tracked answers' },
        }),
      ),
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
      http.get(root + '/ai-traffic/coverage', () =>
        HttpResponse.json({ sources: [], items: [], next_cursor: null }),
      ),
      http.get(root + '/crawl-logs/catalog', () =>
        HttpResponse.json({
          catalog_version: '1',
          bots: [],
          presets: {},
          max_batch_bytes: 2000,
          max_line_bytes: 1000,
          max_lines_per_batch: 10,
          upload_sample_lines: 50,
          max_backdate_days: 80,
          worker_timeout_ms: 5000,
        }),
      ),
      http.get(root + '/ai-traffic/activity', () =>
        HttpResponse.json({ items: [], next_cursor: null }),
      ),
      http.get(root + '/ai-traffic/activity/export', ({ request }) => {
        exportStatus = new URL(request.url).searchParams.get('status');
        return new HttpResponse('path,status\n/page,404', {
          headers: { 'content-type': 'text/csv' },
        });
      }),
      http.get(root + '/ai-traffic/referrals', () => HttpResponse.json(referrals)),
      http.get(root + '/ai-traffic/insights', () =>
        HttpResponse.json({
          snapshot_id: null,
          window_start: '2026-10-01',
          window_end: '2026-10-04',
          formula_version: '1',
          patterns: [],
          coverage: {
            crawl: 'partial',
            ga4_complete: false,
            notice: 'Coverage is incomplete. Absence-based insights are unavailable.',
          },
        }),
      ),
      http.get(root + '/ai-traffic/pages', () =>
        HttpResponse.json({
          window_start: '2026-10-01',
          window_end: '2026-10-04',
          items: [page],
          next_cursor: null,
          observed_crawl_coverage: {
            state: 'unavailable',
            share: null,
            known_pages: 10,
            observed_pages: null,
            inventory_date: null,
            inventory_complete: false,
            sample_mode: true,
            label: 'Observed crawl coverage',
          },
        }),
      ),
      http.get(root + '/ai-traffic/pages/' + page.url_hash, () =>
        HttpResponse.json({
          page,
          window_start: '2026-10-01',
          window_end: '2026-10-04',
          crawls: [],
          referrals: [],
          citations: [],
          provenance: { crawl_id: null, formula_version: '1', bounded: false },
        }),
      ),
      http.get(root + '/ai-traffic/pages/export', ({ request }) => {
        exportedPages.value = new URL(request.url).searchParams;
        return new HttpResponse('path\n/page', { headers: { 'content-type': 'text/csv' } });
      }),
    );
    const view = renderWithProviders(<AiTrafficScreen />);
    await screen.findByText(/No matching requests were observed/);
    expect(await screen.findByText(/Absence-based insights are unavailable/)).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('activity');
    // No retained rows: one contextual empty state instead of headers over nothing.
    expect(await screen.findByRole('heading', { name: 'No matching requests' })).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Retained automated request activity' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Response status' }), {
      target: { value: '404' },
    });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(exportStatus).toBe('404'));
    await user.click(screen.getByRole('tab', { name: 'Referrals' }));
    expect(await screen.findByLabelText('Chart interval')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    await screen.findByRole('table', { name: 'Path-level AI Traffic with separate signal units' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder' }), {
      target: { value: '/page' },
    });
    await user.click(screen.getByRole('combobox', { name: 'Resource class' }));
    await user.click(screen.getByRole('option', { name: 'Page' }));
    await user.click(screen.getByRole('combobox', { name: 'Sort pages' }));
    await user.click(screen.getByRole('option', { name: 'AI referral sessions' }));
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(exportedPages.value?.get('folder')).toBe('/page'));
    expect(exportedPages.value?.get('resource_class')).toBe('page');
    expect(exportedPages.value?.get('sort')).toBe('sessions_desc');
    await user.click(
      screen.getByRole('button', { name: 'View AI Traffic for https://example.test/page' }),
    );
    const panel = await screen.findByRole('dialog', { name: '/page' });
    expect(
      new URL(
        within(panel).getByRole('link', { name: 'Referrals' }).getAttribute('href')!,
        window.location.origin,
      ).searchParams.get('project'),
    ).toBe(project.id);
    expect(within(panel).getByText(/0 requests · Measured zero/)).toBeVisible();
    expect(within(panel).getByText(/Unavailable AI referral sessions · Flagged/)).toBeVisible();
    expect(within(panel).getByText(/Unavailable tracked citations · Not connected/)).toBeVisible();
    expect(
      within(panel).getByText(/open Site Health findings · Unavailable · Coverage is incomplete/),
    ).toBeVisible();
    mswServer.use(
      http.get(
        root + '/ai-traffic/pages/' + page.url_hash,
        () => new HttpResponse(null, { status: 403 }),
      ),
    );
    await view.queryClient.refetchQueries({ predicate: (q) => q.queryKey.includes('url') });
    await waitFor(() =>
      expect(within(panel).queryByText(/0 requests · Measured zero/)).not.toBeInTheDocument(),
    );
  });
  it('leads with Referrals and drops crawl-only views when crawl logs are unavailable', async () => {
    const dashboards: URLSearchParams[] = [];
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('disabled'))),
      http.get(root + '/ai-traffic/referrals', ({ request }) => {
        dashboards.push(new URL(request.url).searchParams);
        return HttpResponse.json(referrals);
      }),
      http.get(root + '/ai-traffic/overview', () =>
        HttpResponse.json({
          crawl: { ...crawl, connection: 'not_connected' },
          referrals,
          citations: { unit: 'tracked_citations', count: 4, label: 'Tracked answers' },
        }),
      ),
      http.get(root + '/ai-traffic/insights', () =>
        HttpResponse.json({
          snapshot_id: null,
          window_start: '2026-10-01',
          window_end: '2026-10-04',
          formula_version: '1',
          patterns: [],
          coverage: { crawl: 'unknown', ga4_complete: false, notice: null },
        }),
      ),
    );
    // A shared link to a crawl-only view still lands somewhere useful, keeping its range.
    window.history.replaceState(null, '', '/ai-traffic?tab=activity&range=90d');
    renderWithProviders(<AiTrafficScreen />);
    expect(await screen.findByText(/covers last 90 days/)).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Referrals' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Collection is paused on this server/)).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Crawlers' })).not.toBeInTheDocument();
    await waitFor(() => expect(dashboards.at(-1)?.get('range')).toBe('90d'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText(/not available for this workspace yet/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Reporting range' })).toHaveTextContent(
      'Last 90 days',
    );
  });
});
