import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { ChangesPanel as ScopedChangesPanel } from './changes-panel';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL_A = '22222222-2222-4222-8222-222222222222';
const CRAWL_B = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT = '44444444-4444-4444-8444-444444444444';
const SITE_URL = '55555555-5555-4555-8555-555555555555';

function ChangesPanel(props: Readonly<{ projectId: string }>) {
  return <ScopedChangesPanel workspaceId={WORKSPACE} {...props} />;
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function response(state: 'available' | 'unavailable' | 'non_comparable') {
  return {
    state,
    reason_code: state === 'non_comparable' ? 'analysis_version_mismatch' : null,
    snapshot_id: state === 'unavailable' ? null : SNAPSHOT,
    crawl_a_id: state === 'unavailable' ? null : CRAWL_A,
    crawl_b_id: state === 'unavailable' ? null : CRAWL_B,
    complete_pair: true,
    analyzer_version: 'site-change-v1',
    page_analyzer_version: 'page-v1',
    extractor_version: 'extract-v1',
    source_analysis_ids: [],
    coverage: {},
    summary: { counts_by_class: { 'critical-regression': 1 } },
    limitations: [],
    created_at: state === 'unavailable' ? null : '2026-08-15T00:00:00Z',
  };
}

function handlers(
  state: 'available' | 'unavailable' | 'non_comparable',
  values: Record<string, unknown> = {},
) {
  const base = `/api/v1/projects/${PROJECT}/site-health/changes`;
  mswServer.use(
    http.get(`${base}/summary`, () => HttpResponse.json(response(state))),
    http.get(base, ({ request }) => {
      const url = new URL(request.url);
      if (
        url.searchParams.get('crawl_a_id') !== CRAWL_A ||
        url.searchParams.get('crawl_b_id') !== CRAWL_B
      ) {
        return HttpResponse.json({ error: { message: 'exact pair required' } }, { status: 422 });
      }
      return HttpResponse.json({
        ...response(state),
        items:
          state === 'available'
            ? [
                {
                  id: '66666666-6666-4666-8666-666666666666',
                  site_url_id: SITE_URL,
                  normalized_url: 'https://acme.test/guide',
                  field: 'http_status',
                  change_class: 'critical-regression',
                  before_value: 200,
                  after_value: 503,
                  source_analysis_a_id: CRAWL_A,
                  source_analysis_b_id: CRAWL_B,
                  source_artifact_a_id: CRAWL_A,
                  source_artifact_b_id: CRAWL_B,
                  source_evaluation_a_id: null,
                  source_evaluation_b_id: null,
                  expected: false,
                  implementation_event_id: null,
                  created_at: '2026-08-15T00:00:00Z',
                  ...values,
                },
              ]
            : [],
        next_cursor: null,
      });
    }),
  );
}

describe('Website Changes', () => {
  it('labels and bounds content records and nested arrays instead of dumping JSON', async () => {
    handlers('available', {
      field: 'content_change',
      before_value: { word_count: 100, heading_outline: ['Introduction'] },
      after_value: {
        word_count: 200,
        content_delta_ratio: 0.5,
        content_change_classification: 'substantial_change',
        heading_outline: Array.from({ length: 10 }, (_, i) => `Heading ${i}`),
        details: { region: { text: 'Nested text' } },
      },
    });
    renderWithProviders(<ChangesPanel projectId={PROJECT} />);
    await userEvent.click(await screen.findByText('View evidence'));
    const after = screen.getByText(/After:/).parentElement!;
    expect(after).toHaveTextContent('word count: 200');
    expect(after).toHaveTextContent('content delta ratio: 0.5');
    expect(after).toHaveTextContent('content change classification: Substantial change');
    expect(after).toHaveTextContent('2 more items not shown');
    expect(after).toHaveTextContent('region: 1 field');
    expect(after).not.toHaveTextContent('Heading 8');
  });
  it('renders regression summary and exact before/after evidence', async () => {
    handlers('available');
    renderWithProviders(<ChangesPanel projectId={PROJECT} />);

    expect(await screen.findByTestId('website-changes')).toHaveTextContent('Critical regression');
    expect(screen.getByRole('link', { name: 'acme.test/guide' })).toHaveAttribute(
      'href',
      `/site/crawls/${CRAWL_B}/pages/${SITE_URL}`,
    );
    await userEvent.click(screen.getByText('View evidence'));
    expect(screen.getByText(/Before:/).parentElement).toHaveTextContent('200');
    expect(screen.getByText(/After:/).parentElement).toHaveTextContent('503');
  });

  it('says when two crawls cannot be compared', async () => {
    handlers('non_comparable');
    renderWithProviders(<ChangesPanel projectId={PROJECT} />);
    expect(await screen.findByText(/analysis version mismatch/i)).toBeInTheDocument();
  });
});
