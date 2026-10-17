import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { SITE_HEALTH_STREAM_RECONNECT_BASE_MS } from '@/lib/config/site-health';
import { useCrawlEvents } from './use-crawl-events';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';
import { testProjectSelection } from '@/test/render';
import { makeStreamResponse } from '@/test/sse';

const CRAWL = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

/**
 * The stream reads its workspace from the shared selection rather than from
 * the module-level header, so the hook needs a resolved context — the same one
 * every authed screen mounts inside.
 */
const WORKSPACE = '99999999-9999-4999-8999-999999999999';

/** A resolved selection naming the workspace the stream belongs to. */
function selectionFor(workspaceId: string | null) {
  return testProjectSelection({ activeWorkspaceId: workspaceId });
}

function wrapper(client: QueryClient, workspaceId: string | null = null) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ProjectSelectionProvider value={selectionFor(workspaceId)}>
          {children}
        </ProjectSelectionProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

afterEach(() => {
  vi.restoreAllMocks();
  // Unstub here rather than at the end of each test body: a failed assertion
  // returns early and would otherwise leave `fetch` stubbed for every test
  // that follows.
  vi.unstubAllGlobals();
});

describe('useCrawlEvents', () => {
  it('sends X-Workspace-Id and credentials, and invalidates on a data frame', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeStreamResponse(['data: {"event_type":"page_updated"}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client, WORKSPACE),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe('include');
    // Carried from the resolved selection, so a reconnect resends the
    // workspace the stream STARTED under rather than whatever is selected now.
    expect(init.headers['X-Workspace-Id']).toBe(WORKSPACE);

    // A lifecycle frame refreshes the dashboard subscription. Its progress
    // fingerprint owns the one downstream list invalidation round.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: queryKeys.siteHealth.dashboard(PROJECT),
        }),
      ),
    );
    vi.unstubAllGlobals();
  });

  it('does not open a stream when disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    renderHook(() => useCrawlEvents(CRAWL, PROJECT, false), {
      wrapper: wrapper(client),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of events into ONE invalidation round', async () => {
    // The backend emits an `analysis.progress` event per analyzed URL, so a
    // large crawl would otherwise fire an invalidation round per URL, each
    // racing the screen's poll timers into out-of-order renders.
    const frames = Array.from(
      { length: 40 },
      (_, i) =>
        `event: crawl.status\nid: ${i}\ndata: {"event_type":"crawl.status","sequence":${i}}\n\n`,
    );
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(frames));
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { unmount } = renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: queryKeys.siteHealth.dashboard(PROJECT),
        }),
      ),
    );
    // Tear the hook down BEFORE counting. This test runs on real timers, and
    // the stream closes cleanly after the 40 frames, so a still-mounted hook
    // schedules a reconnect ~1s later; if the assertions took longer than that
    // the second connection's frames added another invalidation round and the
    // count was no longer 1.
    unmount();
    // Forty lifecycle frames collapse to one dashboard refresh.
    const dashboardCalls = invalidateSpy.mock.calls.filter(
      ([arg]) =>
        JSON.stringify((arg as { queryKey: unknown }).queryKey) ===
        JSON.stringify(queryKeys.siteHealth.dashboard(PROJECT)),
    );
    expect(dashboardCalls).toHaveLength(1);
  });

  it('leaves per-page progress to the bounded dashboard poll', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          'event: analysis.progress\nid: 1\ndata: {"event_type":"analysis.progress"}\n\n',
          'event: discovery.progress\nid: 2\ndata: {"event_type":"discovery.progress"}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('reconnects after a clean close, resuming from the last event id', async () => {
    // The server closes the stream at its max duration. Without a reconnect a
    // crawl longer than that silently degrades to poll-only partway through.
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeStreamResponse(['event: x\nid: evt-7\ndata: {"a":1}\n\n']))
      .mockResolvedValue(makeStreamResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(SITE_HEALTH_STREAM_RECONNECT_BASE_MS + 50);
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    const [, retryInit] = fetchMock.mock.calls[1]!;
    expect(retryInit.headers['Last-Event-ID']).toBe('evt-7');

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('backs off when a clean close delivered nothing', async () => {
    // A stream that ends immediately (terminal crawl already flushed, a proxy
    // that will not hold streams open, an empty body) closes *cleanly*, so
    // resetting the backoff on clean closure alone turned this into a
    // permanent 1 req/s reconnect loop for as long as the crawl was active.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    const { unmount } = renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // First retry is still one base interval away.
    await vi.advanceTimersByTimeAsync(SITE_HEALTH_STREAM_RECONNECT_BASE_MS + 50);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The second wait is DOUBLE the base — one more base interval is not
    // enough. Without backoff this would already be the third connection.
    await vi.advanceTimersByTimeAsync(SITE_HEALTH_STREAM_RECONNECT_BASE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SITE_HEALTH_STREAM_RECONNECT_BASE_MS + 50);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    unmount();
    vi.useRealTimers();
  });

  it('stops reconnecting once the hook is torn down', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient();
    const { unmount } = renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();
    const afterUnmount = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SITE_HEALTH_STREAM_RECONNECT_BASE_MS * 5);
    expect(fetchMock.mock.calls).toHaveLength(afterUnmount);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('swallows a failed stream so polling is never blocked', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useCrawlEvents(CRAWL, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // No throw, no invalidation from a dead stream.
    expect(invalidateSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
