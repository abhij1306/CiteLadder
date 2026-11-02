import { render, screen } from '@testing-library/react';
import { Component, lazy, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { IslandUnavailable, LazyIsland } from './lazy-island';

const sink = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve(new Response(null, { status: 204 })),
);

/** The reports the sink received, as the API reads them. */
function reports() {
  return sink.mock.calls.map(([url, init]) => ({
    url,
    keepalive: init.keepalive,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  }));
}

class ScreenBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  override render() {
    return this.state.message === null ? (
      this.props.children
    ) : (
      <p>Screen failed: {this.state.message}</p>
    );
  }
}

beforeEach(() => {
  sink.mockClear();
  vi.stubGlobal('fetch', sink);
  // React reports every caught error; the assertions are on what renders and is sent.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Lazy island', () => {
  it('keeps the surrounding content, shows its fallback and reports a chunk that cannot load', async () => {
    const Missing = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /app-assets/a.js')),
    );

    render(
      <section aria-label="Usage">
        <h2>Source usage</h2>
        <LazyIsland
          label="chart"
          defects="surface"
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
    expect(reports()).toEqual([
      {
        url: '/api/v1/client-errors',
        keepalive: true,
        body: expect.objectContaining({
          kind: 'chunk_load',
          message: 'Failed to fetch dynamically imported module: /app-assets/a.js',
          route: '/',
          release: 'development',
          component: 'chart',
        }),
      },
    ]);
  });

  it('hands a render defect to the screen boundary and reports it once as a render error', () => {
    function BrokenPlot(): ReactNode {
      throw new TypeError("Cannot read properties of undefined (reading 'points')");
    }
    const tree = () => (
      <ScreenBoundary>
        <LazyIsland
          label="chart"
          defects="surface"
          failed={<IslandUnavailable message="Couldn't load chart." />}
        >
          <BrokenPlot />
        </LazyIsland>
      </ScreenBoundary>
    );

    const { unmount } = render(tree());
    expect(
      screen.getByText("Screen failed: Cannot read properties of undefined (reading 'points')"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load chart.")).not.toBeInTheDocument();
    unmount();
    // The same defect again in this page load is not sent twice.
    render(tree());

    expect(reports().map((r) => r.body)).toEqual([
      expect.objectContaining({
        kind: 'render',
        message: "Cannot read properties of undefined (reading 'points')",
        component: 'chart',
        stack: expect.stringContaining('TypeError'),
      }),
    ]);
  });
});
