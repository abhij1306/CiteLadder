import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { mswServer } from '@/test/msw-server';
import { chooseFilterOption, openFilterOptions, openFilterRow } from '@/test/all-filters';
import { projectScope, renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { AiTrafficScreen } from './ai-traffic-screen';
import { InsightStrip } from './insight-strip';
import { CrawlLogConnections } from './crawl-log-connections';
const project = makeProject({
  id: '88888888-8888-4888-8888-888888888888',
  workspace_id: '11111111-1111-4111-8111-111111111111',
});
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
  window_start: null,
  window_end: null,
  granularity: 'day',
  referral_volume: [],
  referral_share: [],
  sources: [],
  analyzer_version: '1',
  formula_version: '1',
};
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
async function openEmptySetup() {
  const user = userEvent.setup();
  renderWithProviders(<CrawlLogConnections />, { projectSelection: projectScope(project) });
  await screen.findByRole('heading', { name: 'No crawl logs connected' });
  await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
  return user;
}
const STALLED_SOURCE = {
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
};
beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
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
    renderWithProviders(<CrawlLogConnections />, { projectSelection: projectScope(project) });
    expect(await screen.findByText(/Collection is paused on this server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
  });
  it('shows why a live source is stalled on its row', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(sourceBody('available', [STALLED_SOURCE])),
      ),
    );
    renderWithProviders(<CrawlLogConnections />, { projectSelection: projectScope(project) });
    expect(await screen.findByText(/Custom webhook · Connected · Stalled/)).toBeVisible();
    expect(
      screen.getByText('A batch over 5 MiB was dropped. Lower the stream buffer size.'),
    ).toBeVisible();
  });
  it('keeps setup unavailable on a failed availability read and recovers on retry', async () => {
    mswServer.use(
      http.get(root + '/crawl-logs/sources', () => new HttpResponse(null, { status: 500 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />, { projectSelection: projectScope(project) });
    await user.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
    const dialog = screen.getByRole('dialog');
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
    const user = await openEmptySetup();
    await user.click(await screen.findByRole('radio', { name: /Upload file/ }));
    expect(screen.getByText('Create an upload source first.')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Upload source' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create source' }));
    expect(await screen.findByRole('combobox', { name: 'Upload source' })).toHaveTextContent(
      'example.test',
    );
    await user.upload(screen.getByLabelText('Log file'), new File(['{}'], 'requests.ndjson'));
    expect(screen.getByRole('button', { name: 'Upload recognized requests' })).toBeEnabled();
  });
  it.each([
    [null, 'complete', true, 'No patterns'],
    [null, 'partial', false, 'No patterns'],
    ['Coverage is incomplete.', 'partial', false, 'Coverage is incomplete.'],
  ])(
    'keeps the insights card in place when nothing was observed (%s, %s crawl)',
    async (notice, crawl, ga4Complete, shown) => {
      mswServer.use(
        http.get(root + '/ai-traffic/insights', () =>
          HttpResponse.json({
            snapshot_id: null,
            window_start: '2026-10-01',
            window_end: '2026-10-04',
            formula_version: '1',
            patterns: [],
            coverage: { crawl, ga4_complete: ga4Complete, notice },
          }),
        ),
      );
      renderWithProviders(
        <InsightStrip projectId={project.id} workspaceId={project.workspace_id} range="30d" />,
        { projectSelection: projectScope(project) },
      );
      expect(await screen.findByText(shown)).toBeVisible();
      expect(screen.getByText('Observed patterns')).toBeVisible();
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
    const user = await openEmptySetup();
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
    const user = await openEmptySetup();
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
    await openEmptySetup();
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
    renderWithProviders(<CrawlLogConnections />, { projectSelection: projectScope(project) });
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
    const user = await openEmptySetup();
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
      { projectSelection: projectScope(project) },
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
  it('shows one setup state, without filters, on every view while nothing is connected', async () => {
    mswServer.use(
      http.get('/api/v1/integrations', () => HttpResponse.json([])),
      http.get(root + '/crawl-logs/sources', () => HttpResponse.json(sourceBody('available'))),
      http.get(root + '/ai-traffic/overview', () =>
        HttpResponse.json({
          crawl: { ...crawl, connection: 'not_connected' },
          referrals,
          citations: {
            unit: 'tracked_citations',
            state: 'not_available',
            reason: 'no_completed_run',
            count: null,
            label: 'Tracked answers',
          },
        }),
      ),
    );
    renderWithProviders(<AiTrafficScreen />, { projectSelection: projectScope(project) });
    expect(await screen.findByRole('heading', { name: 'Connect a traffic source' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Connect Google Analytics 4' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'AI traffic key figures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Period:/ })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByRole('heading', { name: 'Connect a traffic source' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Period:/ })).not.toBeInTheDocument();
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
          citations: {
            unit: 'tracked_citations',
            state: 'measured',
            count: 0,
            label: 'Tracked answers',
            sources: [{ audit_id: '99999999-9999-4999-8999-999999999999', analyzer_version: '1' }],
          },
        }),
      ),
      http.get(root + '/crawl-logs/sources', () =>
        HttpResponse.json(sourceBody('available', [STALLED_SOURCE])),
      ),
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
          page: {
            ...page,
            crawl: { state: 'flagged', value: 3, coverage: 'partial', reason: null },
            referrals: { ...page.referrals, reason: 'projection_pending' },
            key_events: 2,
          },
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
    const view = renderWithProviders(<AiTrafficScreen />, {
      projectSelection: projectScope(project),
    });
    await screen.findByText(/No matching requests were observed/);
    expect(await screen.findByText(/Absence-based insights are unavailable/)).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('activity');
    const activityTable = await screen.findByRole('region', {
      name: 'Retained automated request activity',
    });
    expect(
      await within(activityTable).findByRole('heading', { name: 'No matching requests' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /^Period:/ })).toBeVisible();
    await openFilterOptions(user, 'Status code');
    const statusField = await screen.findByRole('spinbutton', { name: 'Response status' });
    const statusRow = () => screen.getByRole('menuitem', { name: /^Status code:/ });
    fireEvent.change(statusField, { target: { value: '40' } });
    expect(statusRow()).toHaveAccessibleName('Status code: Any status');
    fireEvent.change(statusField, { target: { value: '404' } });
    expect(statusRow()).toHaveAccessibleName('Status code: 404');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Filters (1)' })).toHaveAttribute(
      'data-active',
    );
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(exportStatus).toBe('404'));
    await user.click(await within(activityTable).findByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('status')).toBeNull(),
    );
    await user.click(screen.getByRole('tab', { name: 'Referrals' }));
    expect(await openFilterRow(user, 'Chart interval', 'Week')).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    await screen.findByRole('table', { name: 'Path-level AI traffic with separate signal units' });
    await chooseFilterOption(user, 'Resource class', 'Page');
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('resource')).toBe('page'),
    );
    await openFilterOptions(user, 'Folder');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Folder' }), {
      target: { value: '/page' },
    });
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Filters (2)' })).toHaveAttribute(
      'data-active',
    );
    await user.click(screen.getByRole('button', { name: /^Requests/ }));
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(exportedPages.value?.get('folder')).toBe('/page'));
    expect(exportedPages.value?.get('resource_class')).toBe('page');
    expect(exportedPages.value?.get('sort')).toBe('requests_desc');
    await user.click(
      screen.getByRole('button', { name: 'View AI traffic for https://example.test/page' }),
    );
    const panel = await screen.findByRole('dialog', { name: '/page' });
    expect(
      new URL(
        within(panel).getByRole('link', { name: 'Referrals' }).getAttribute('href')!,
        window.location.origin,
      ).searchParams.get('project'),
    ).toBe(project.id);
    const record = (name: string) =>
      within(panel).queryByText(name, { selector: 'dt' })?.nextElementSibling?.textContent;
    expect(within(panel).getByText(/^Sources:/)).toHaveTextContent(
      'Sources: Crawlers · Referrals · Visibility · Site health',
    );
    expect(record('Crawler requests')).toBeUndefined();
    expect(
      within(panel).getByRole('heading', { name: 'First and last observations' }).parentElement,
    ).toHaveTextContent('First and last observations—None');
    mswServer.use(
      http.get(
        root + '/ai-traffic/pages/' + page.url_hash,
        () => new HttpResponse(null, { status: 403 }),
      ),
    );
    await view.queryClient.refetchQueries({ predicate: (q) => q.queryKey.includes('url') });
    await waitFor(() =>
      expect(within(panel).queryByText('First and last observations')).not.toBeInTheDocument(),
    );
  }, 20_000);
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
          citations: {
            unit: 'tracked_citations',
            state: 'measured',
            count: 4,
            label: 'Tracked answers',
            sources: [{ audit_id: '99999999-9999-4999-8999-999999999999', analyzer_version: '1' }],
          },
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
    window.history.replaceState(null, '', '/ai-traffic?tab=activity&range=90d');
    renderWithProviders(<AiTrafficScreen />, { projectSelection: projectScope(project) });
    expect(await screen.findByText(/covers last 90 days/)).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Referrals' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Collection is paused on this server/)).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Crawlers' })).not.toBeInTheDocument();
    await waitFor(() => expect(dashboards.at(-1)?.get('range')).toBe('90d'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(
      await screen.findByRole('button', { name: 'About Crawler requests' }),
    ).toHaveAccessibleDescription(/not available for this workspace yet/);
    expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
    expect(await openFilterRow(user, 'Period', 'Last 90 days')).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /^Verification/ })).not.toBeInTheDocument();
  });
});
