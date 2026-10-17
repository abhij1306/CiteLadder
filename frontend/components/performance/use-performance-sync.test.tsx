import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';
import { usePerformanceSync } from './use-performance-sync';

const { syncNow, getSync } = vi.hoisted(() => ({ syncNow: vi.fn(), getSync: vi.fn() }));
vi.mock('@/lib/api/performance', () => ({ performanceApi: { syncNow } }));
vi.mock('@/lib/api/integrations', () => ({ integrationsApi: { getSync } }));

function Sync({ projectId }: Readonly<{ projectId: string }>) {
  const sync = usePerformanceSync(projectId);
  return (
    <button onClick={() => sync.mutation.mutate()}>{sync.syncing ? 'Syncing' : 'Sync now'}</button>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('Performance sync in flight', () => {
  it('stays syncing after the import finishes until the reports are rebuilt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    syncNow.mockResolvedValue([
      {
        connection_id: '33333333-3333-4333-8333-333333333333',
        sync_run_id: '44444444-4444-4444-8444-444444444444',
      },
    ]);
    getSync
      .mockResolvedValueOnce({ status: 'succeeded', processing: true })
      .mockResolvedValue({ status: 'succeeded', processing: false });
    renderWithProviders(<Sync projectId="11111111-1111-4111-8111-111111111111" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(getSync).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Syncing' })).toBeVisible();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeVisible();
  });
});

describe('Performance sync scope', () => {
  it('stops tracking the old batch when the selected project changes', async () => {
    syncNow.mockResolvedValue([
      {
        connection_id: '33333333-3333-4333-8333-333333333333',
        sync_run_id: '44444444-4444-4444-8444-444444444444',
      },
    ]);
    getSync.mockResolvedValue({ status: 'running' });
    const { rerender } = renderWithProviders(
      <Sync projectId="11111111-1111-4111-8111-111111111111" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await screen.findByRole('button', { name: 'Syncing' });
    await waitFor(() => expect(getSync).toHaveBeenCalledTimes(1));

    rerender(<Sync projectId="22222222-2222-4222-8222-222222222222" />);
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeVisible();
    expect(getSync).toHaveBeenCalledTimes(1);
  });

  it('does not begin polling a late enqueue response for the previous project', async () => {
    let finish!: (runs: unknown[]) => void;
    syncNow.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderWithProviders(
      <Sync projectId="11111111-1111-4111-8111-111111111111" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
    rerender(<Sync projectId="22222222-2222-4222-8222-222222222222" />);
    await act(async () => {
      finish([
        {
          connection_id: '33333333-3333-4333-8333-333333333333',
          sync_run_id: '44444444-4444-4444-8444-444444444444',
        },
      ]);
    });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeVisible();
    expect(getSync).not.toHaveBeenCalled();
  });
});
