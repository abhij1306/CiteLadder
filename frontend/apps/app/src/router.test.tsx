import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const bootstrap = vi.hoisted(() => vi.fn());
// This file is about chunk download and shell persistence across a navigation.
// The real bootstrap loader would issue the session and workspace reads, which
// belong to `bootstrap-loader.test.ts`; here they would only make the route
// wait on a request nothing answers. The session wait these tests care about is
// modelled by the `PrivateRouteLayout` stub below.
vi.mock('@/lib/project/bootstrap-loader', () => ({
  bootstrapPrivateRoutes: () => null,
}));
vi.mock('./private-routes', () => ({
  PrivateRouteLayout: () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      bootstrap();
    }, []);
    return ready ? <Outlet /> : <button onClick={() => setReady(true)}>Finish session</button>;
  },
  ApplicationRouteLayout: () => (
    <section aria-label="Application shell">
      <Outlet />
    </section>
  ),
}));
vi.mock('@/components/projects/projects-screen', () => ({
  ProjectsScreen: () => <h1>Overview</h1>,
}));

beforeEach(() => {
  vi.resetModules();
  bootstrap.mockClear();
});

async function privateRouter() {
  const { appRoutes } = await import('./router');
  return createMemoryRouter(appRoutes, {
    initialEntries: ['/issues?project=11111111-1111-4111-8111-111111111111'],
  });
}

describe('application route recovery', () => {
  it('enters the existing product bootstrap from the app root', async () => {
    const { appRoutes } = await import('./router');
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('button', { name: 'Finish session' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/projects');
    router.dispose();
  });

  it('downloads the route alongside session bootstrap and keeps the shell through the content wait', async () => {
    let finish!: (module: { IssuesRoute: () => React.JSX.Element }) => void;
    const downloaded = new Promise<{ IssuesRoute: () => React.JSX.Element }>((resolve) => {
      finish = resolve;
    });
    const download = vi.fn(() => downloaded);
    vi.doMock('./product-routes-site-issues', download);
    const router = await privateRouter();
    render(<RouterProvider router={router} />);

    await screen.findByRole('button', { name: 'Finish session' });
    // The bootstrap effect flushes asynchronously after the button paints.
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Issues' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }));
    const shell = screen.getByRole('region', { name: 'Application shell' });
    expect(screen.getByTestId('page-loading')).toBeInTheDocument();
    await act(async () => finish({ IssuesRoute: () => <h1>Issues</h1> }));
    expect(await screen.findByRole('heading', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Application shell' })).toBe(shell);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/issues');
    expect(router.state.location.search).toContain('project=');

    await act(async () => {
      await router.navigate('/projects');
    });
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Application shell' })).toBe(shell);
    router.dispose();
  });

  it('offers a reload inside the shell when a route chunk fails instead of exposing a stack trace', async () => {
    vi.doMock('./product-routes-site-issues', () =>
      Promise.reject(new Error('private chunk URL failed')),
    );
    const router = await privateRouter();
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Finish session' }));
    expect(await screen.findByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Application shell' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.queryByText(/private chunk URL failed/)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/issues');
    router.dispose();
  });

  it('answers an unknown application address with a not-found screen inside the shell', async () => {
    const { appRoutes } = await import('./router');
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/setting'] });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Finish session' }));
    expect(
      await screen.findByRole('heading', { name: 'There is no page at this address' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Application shell' })).toBeInTheDocument();
    router.dispose();
  });
});
