import { render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { IslandUnavailable, LazyIsland } from './lazy-island';

afterEach(() => vi.restoreAllMocks());

describe('Lazy island', () => {
  it('keeps the surrounding content and shows its fallback when the chunk cannot load', async () => {
    // React reports the caught error; the assertion is on what renders.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Missing = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module')),
    );

    render(
      <section aria-label="Usage">
        <h2>Source usage</h2>
        <LazyIsland
          loading={<p>Loading chart</p>}
          failed={<IslandUnavailable message="Couldn't load chart." />}
        >
          <Missing />
        </LazyIsland>
      </section>,
    );

    expect(screen.getByText('Loading chart')).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load chart.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Source usage' })).toBeInTheDocument();
    expect(screen.queryByText('Loading chart')).not.toBeInTheDocument();
  });
});
