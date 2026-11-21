import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { setUrlStateRouter } from '@/lib/navigation/url-state';

import { useActionFilters } from './use-action-filters';

function Probe() {
  const filters = useActionFilters();
  return (
    <button type="button" onClick={filters.clear}>
      Clear filters
    </button>
  );
}

afterEach(() => setUrlStateRouter(null));

describe('useActionFilters', () => {
  it('clears both filters at once, keeping the status and grouping, under a router whose navigations land later', async () => {
    globalThis.history.replaceState(
      null,
      '',
      '/actions?project=p1&status=dismissed&group_by=impact&impact=high&source=site_health',
    );
    const router = createBrowserRouter([
      { path: '/actions', loader: () => null, element: <Probe /> },
    ]);
    setUrlStateRouter(router);
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));

    await waitFor(() =>
      expect(globalThis.location.search).toBe('?project=p1&status=dismissed&group_by=impact'),
    );
    expect(router.state.navigation.state).toBe('idle');
    router.dispose();
  });
});
