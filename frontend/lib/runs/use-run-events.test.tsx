import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { RUN_STREAM_RECONNECT_BASE_MS } from '@/lib/config/runs';
import { useRunEvents } from './use-run-events';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';
import { testProjectSelection } from '@/test/render';
import { makeStreamResponse } from '@/test/sse';

const AUDIT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

/** The stream reads its workspace from the shared selection. */
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** A resolved selection naming the workspace the stream belongs to. */
function selectionFor(workspaceId: string | null) {
  return testProjectSelection({ activeWorkspaceId: workspaceId });
}

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ProjectSelectionProvider value={selectionFor(WORKSPACE)}>
          {children}
        </ProjectSelectionProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRunEvents', () => {
  it('debounces chunked terminal frames into the run-specific invalidations', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          'id: evt-9\ndata: {"id":"11111111-1111-4111-8111-111111111111","audit_id":"11111111-1111-4111-8111-111111111111","occurred_at":"2026-01-01T00:00:00Z","event_type":"audit.com',
          'pleted","payload":{"status":"completed","completed":1,"failed":0,"visibility_score":1}}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { unmount } = renderHook(() => useRunEvents(AUDIT, PROJECT, true), {
      wrapper: wrapper(client),
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(300);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.runs.detail(AUDIT),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.runs.executions(AUDIT),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.visibility.all,
    });
    unmount();
  });

  it('reconnects with Last-Event-ID and aborts the stream on teardown', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeStreamResponse(['id: evt-7\ndata: {"event_type":"unknown"}\n\n']))
      .mockResolvedValue(makeStreamResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const { unmount } = renderHook(() => useRunEvents(AUDIT, PROJECT, true), {
      wrapper: wrapper(client),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(RUN_STREAM_RECONNECT_BASE_MS + 50);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![1].headers['Last-Event-ID']).toBe('evt-7');

    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
