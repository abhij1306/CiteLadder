import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { BackfillProgress as ScopedBackfillProgress } from './backfill-progress';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION = '33333333-3333-4333-8333-333333333333';

function BackfillProgress(props: Readonly<{ connectionId: string }>) {
  return <ScopedBackfillProgress workspaceId={WORKSPACE} {...props} />;
}

function progress(overrides: Record<string, unknown> = {}) {
  return {
    connection_id: CONNECTION,
    state: 'complete',
    total_windows: 14,
    completed_windows: 14,
    failed_windows: 0,
    pending_windows: 0,
    covered_from: '2025-09-05',
    covered_through: '2026-09-03',
    ...overrides,
  };
}

function mockProgress(body: Record<string, unknown>) {
  mswServer.use(
    http.get(`*/api/v1/integrations/${CONNECTION}/syncs/progress`, () => HttpResponse.json(body)),
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('BackfillProgress', () => {
  it('renders nothing when no import was ever enqueued', async () => {
    // `not_started` is NOT "0 of 0 windows" — there is no import to report on,
    // and a zero would read as one that has covered nothing.
    mockProgress(progress({ state: 'not_started', total_windows: 0, completed_windows: 0 }));
    renderWithProviders(<BackfillProgress connectionId={CONNECTION} />);

    // Give the query a chance to resolve before asserting the absence.
    await expect(screen.findByText(/History/)).rejects.toThrow();
  });

  it('counts windows while the import is draining', async () => {
    mockProgress(
      progress({
        state: 'importing',
        completed_windows: 6,
        pending_windows: 8,
        covered_from: null,
        covered_through: null,
      }),
    );
    renderWithProviders(<BackfillProgress connectionId={CONNECTION} />);

    expect(await screen.findByText('Importing — 6 of 14 windows')).toBeInTheDocument();
  });

  it('shows the covered date range once the import completes', async () => {
    mockProgress(progress());
    renderWithProviders(<BackfillProgress connectionId={CONNECTION} />);

    expect(await screen.findByText('Sep 5–Sep 3')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('names the failed windows instead of implying complete coverage', async () => {
    // A partial import must not present its covered range as the whole
    // history: the failed windows are a hole in it.
    mockProgress(progress({ state: 'partial', completed_windows: 12, failed_windows: 2 }));
    renderWithProviders(<BackfillProgress connectionId={CONNECTION} />);

    expect(await screen.findByText(/2 of 14 windows failed/)).toBeInTheDocument();
  });

  it('distinguishes a completed import that measured nothing', async () => {
    // Every window succeeded and the provider returned no rows: that is an
    // observed empty history, not a missing one.
    mockProgress(progress({ covered_from: null, covered_through: null }));
    renderWithProviders(<BackfillProgress connectionId={CONNECTION} />);

    expect(await screen.findByText('No history imported')).toBeInTheDocument();
  });
});
