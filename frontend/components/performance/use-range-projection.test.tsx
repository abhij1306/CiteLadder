import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import type { PerformanceDashboard } from '@/lib/api/performance';
import { useRangeProjection } from './use-range-projection';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const TASK = '33333333-3333-4333-8333-333333333333';
const RANGE = `/api/v1/projects/${PROJECT}/performance/range`;

/** A dashboard whose selected window has no projection yet. */
function unprojected(from: string): PerformanceDashboard {
  const empty = { clicks: null, impressions: null, ctr: null, position: null };
  return {
    project_id: PROJECT,
    range: 'last_synced',
    granularity: 'day',
    compare: 'none',
    selected: {
      snapshot_id: null,
      window_start: from,
      window_end: '2026-08-28',
      evidence_state: 'not_run',
      totals: { ...empty, sessions: null, key_events: null },
      series: { clicks: [], impressions: [], ctr: [], position: [] },
    },
    comparison: null,
    coverage: { earliest_date: null, latest_date: null, covered_days: 0, analytics_quality: {} },
    dimension_counts: {
      query: 0,
      page: 0,
      country: 0,
      device: 0,
      search_appearance: 0,
      day: 0,
      bing_query: 0,
      bing_page: 0,
    },
    unavailable_dimensions: [],
    formula_version: 'traffic-formula-1',
    normalization_version: 'traffic-normalization-1',
  };
}

function Harness({ from }: Readonly<{ from: string }>) {
  const { projecting, failure } = useRangeProjection(
    { workspaceId: WORKSPACE, projectId: PROJECT },
    unprojected(from),
  );
  return (
    <>
      <output>{projecting ? 'Projecting' : 'Idle'}</output>
      {failure ? (
        <div role="alert">
          {failure.error instanceof Error ? failure.error.message : 'Refused'}
          <button type="button" onClick={failure.retry}>
            Retry
          </button>
        </div>
      ) : null}
    </>
  );
}

function rangeTask(status: string, from = '2026-08-01') {
  return HttpResponse.json({
    task_id: TASK,
    status,
    window_start: from,
    window_end: '2026-08-28',
  });
}

/** A response held until the test opens it. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('useRangeProjection', () => {
  it('reports a refused enqueue and clears it while Retry enqueues the window again', async () => {
    const requests: string[] = [];
    const retry = gate();
    mswServer.use(
      http.post(RANGE, async () => {
        requests.push('enqueue');
        if (requests.length === 1) return HttpResponse.json({ detail: 'refused' }, { status: 503 });
        await retry.opened;
        return rangeTask('queued');
      }),
      http.get(`${RANGE}/${TASK}`, () => rangeTask('running')),
    );
    renderWithProviders(<Harness from="2026-08-01" />);

    expect(await screen.findByRole('alert')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    retry.open();
    expect(await screen.findByText('Projecting')).toBeVisible();
  });

  it('reports a cancelled build as cancelled and stops projecting', async () => {
    mswServer.use(
      http.post(RANGE, () => rangeTask('queued')),
      http.get(`${RANGE}/${TASK}`, () => rangeTask('cancelled')),
    );
    renderWithProviders(<Harness from="2026-08-01" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Building this range was cancelled.',
    );
    expect(screen.getByText('Idle')).toBeVisible();
  });

  it('does not show an earlier failure when the reader returns to that window', async () => {
    const enqueued: string[] = [];
    const third = gate();
    mswServer.use(
      http.post(RANGE, async ({ request }) => {
        const from = new URL(request.url).searchParams.get('from') ?? '';
        enqueued.push(from);
        if (enqueued.length === 2) return HttpResponse.json({ detail: 'refused' }, { status: 503 });
        if (enqueued.length === 3) await third.opened;
        return rangeTask('queued', from);
      }),
      http.get(`${RANGE}/${TASK}`, () => rangeTask('failed')),
    );
    const { rerender } = renderWithProviders(<Harness from="2026-08-01" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Building this range from imported data failed.',
    );

    rerender(<Harness from="2026-08-02" />);
    await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('failed'));
    rerender(<Harness from="2026-08-01" />);

    await waitFor(() => expect(enqueued).toEqual(['2026-08-01', '2026-08-02', '2026-08-01']));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    third.open();
  });

  it("reports the new window's refused enqueue after the previous window's build fails", async () => {
    const earlierBuild = gate();
    const laterEnqueue = gate();
    mswServer.use(
      http.post(RANGE, async ({ request }) => {
        const from = new URL(request.url).searchParams.get('from') ?? '';
        if (from === '2026-08-01') return rangeTask('queued', from);
        await laterEnqueue.opened;
        return HttpResponse.json({ detail: 'refused' }, { status: 503 });
      }),
      http.get(`${RANGE}/${TASK}`, async () => {
        await earlierBuild.opened;
        return rangeTask('failed');
      }),
    );
    const { rerender } = renderWithProviders(<Harness from="2026-08-01" />);
    expect(await screen.findByText('Projecting')).toBeVisible();

    rerender(<Harness from="2026-08-02" />);
    earlierBuild.open();
    expect(await screen.findByText('Idle')).toBeVisible();
    laterEnqueue.open();

    expect(await screen.findByRole('alert')).not.toHaveTextContent('failed');
  });
});
