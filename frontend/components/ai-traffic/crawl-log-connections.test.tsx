import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { CrawlLogConnections } from './crawl-log-connections';

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
const id = '99999999-9999-4999-8999-999999999999';

/** An active, connected source; `overrides` set its setup and pull details. */
const source = (overrides: Record<string, unknown>) => ({
  id,
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
  pull: null,
  ...overrides,
});
const sources = (...items: ReturnType<typeof source>[]) =>
  http.get(root + '/crawl-logs/sources', () =>
    HttpResponse.json({
      availability: 'available',
      gcp_pull: {
        availability: 'available',
        reader_email: 'citeladder-log-reader@example.iam.gserviceaccount.com',
        log_filter: 'resource.type="http_load_balancer"',
        catalog_version: '2',
      },
      items,
    }),
  );

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('crawl-log token rotation', () => {
  it('shows the Firehose endpoint for a rotated Amazon CloudFront token', async () => {
    mswServer.use(
      sources(
        source({
          setup: 'aws_firehose',
          preset: 'cloudfront_v2_json',
          buffer_interval_seconds: 60,
          collection_point: 'cdn_edge',
        }),
      ),
      http.post(root + '/crawl-logs/sources/' + id + '/rotate', () =>
        HttpResponse.json({ id, token: 'clw_rotated' }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(await screen.findByRole('button', { name: 'Rotate token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate token' });
    await user.click(within(dialog).getByRole('button', { name: 'Rotate token' }));
    expect(
      await within(dialog).findByText(new RegExp('/v1/crawl-logs/firehose/' + id)),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Create source' })).not.toBeInTheDocument();
  });

  it('names a failed rotation and retries the rotation, not a new source', async () => {
    let rotations = 0,
      creates = 0;
    mswServer.use(
      sources(source({})),
      http.post(root + '/crawl-logs/sources/' + id + '/rotate', () => {
        rotations += 1;
        return rotations === 1
          ? HttpResponse.json({ error: 'unavailable' }, { status: 503 })
          : HttpResponse.json({ id, token: 'clw_rotated' });
      }),
      http.post(root + '/crawl-logs/sources', () => {
        creates += 1;
        return HttpResponse.json({ id, token: 'clw_new' });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    await user.click(await screen.findByRole('button', { name: 'Rotate token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate token' });
    await user.click(within(dialog).getByRole('button', { name: 'Rotate token' }));
    expect(await within(dialog).findByText(/rotate the token/i)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Rotate again' }));
    expect(await within(dialog).findByRole('button', { name: 'Copy token' })).toBeVisible();
    expect(rotations).toBe(2);
    expect(creates).toBe(0);
  });
});

describe('sink filter confirmation', () => {
  it('keeps a failed sink filter confirmation on the source that failed', async () => {
    const pullSource = (sourceId: string, host: string) =>
      source({
        id: sourceId,
        kind: 'pull',
        setup: 'gcp_pubsub_pull',
        preset: 'gcp_log_entry',
        collection_point: 'cdn_edge',
        origin: 'https://' + host,
        host,
        token_prefix: null,
        pull: {
          subscription: 'projects/acme-prod/subscriptions/' + host,
          verification_nonce: 'abcdefghijklmnopqrstuvwxyz',
          verified_at: '2026-10-01T00:00:00.000Z',
          verification_checked_at: '2026-10-10T00:00:00.000Z',
          verification_failure: null,
          filter_catalog_version: '1',
          filter_confirmed_at: null,
          filter_current: false,
          declared_sample_rate: 1,
          last_pull_at: null,
          last_drained_at: '2026-10-09T00:00:00.000Z',
        },
      });
    const a = '99999999-9999-4999-8999-999999999991',
      b = '99999999-9999-4999-8999-999999999992';
    mswServer.use(
      sources(pullSource(a, 'a.acme.com'), pullSource(b, 'b.acme.com')),
      http.post(root + '/crawl-logs/sources/' + a + '/filter-confirmation', () =>
        HttpResponse.json({ error: 'unavailable' }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CrawlLogConnections />);
    const first = await screen.findByRole('region', { name: 'Sink filter update for a.acme.com' });
    const second = screen.getByRole('region', { name: 'Sink filter update for b.acme.com' });
    await user.click(within(first).getByRole('button', { name: 'I’ve updated it' }));
    expect(await within(first).findByText(/confirm the sink filter/i)).toBeVisible();
    expect(within(second).queryByText(/confirm the sink filter/i)).not.toBeInTheDocument();
    expect(within(second).getByRole('button', { name: 'I’ve updated it' })).not.toHaveAttribute(
      'aria-busy',
    );
  });
});
