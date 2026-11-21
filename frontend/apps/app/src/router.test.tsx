import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const bootstrap = vi.hoisted(() => vi.fn());
const sessionRead = vi.hoisted(() => ({ fails: false }));
vi.mock('@/lib/project/bootstrap-loader', () => ({
  bootstrapPrivateRoutes: () => {
    if (sessionRead.fails) throw new Error('session read failed');
    return null;
  },
}));
vi.mock('@/components/auth/auth-routes', () => ({
  LoginRoute: () => <h1>Sign in</h1>,
  RegisterRoute: () => <h1>Register</h1>,
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
  sessionRead.fails = false;
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
    let finish!: (module: { IssuesScreen: () => React.JSX.Element }) => void;
    const downloaded = new Promise<{ IssuesScreen: () => React.JSX.Element }>((resolve) => {
      finish = resolve;
    });
    const download = vi.fn(() => downloaded);
    vi.doMock('@/components/site-health/issues-screen', download);
    const router = await privateRouter();
    render(<RouterProvider router={router} />);

    await screen.findByRole('button', { name: 'Finish session' });
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Issues' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }));
    const shell = screen.getByRole('region', { name: 'Application shell' });
    expect(
      await screen.findByRole('status', { name: 'Loading the issue summary' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Issues' })).toBeInTheDocument();
    await act(async () => finish({ IssuesScreen: () => <p>Issue catalog</p> }));
    expect(await screen.findByText('Issue catalog')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    vi.doMock('@/components/site-health/issues-screen', () =>
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

  it('shows a failed session read as a page with its main region, a reload and a way to Overview', async () => {
    sessionRead.fails = true;
    const router = await privateRouter();
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'This page could not be opened',
    });
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getAllByRole('heading')).toEqual([heading]);
    expect(within(main).getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.queryByText(/session read failed/)).not.toBeInTheDocument();
    router.dispose();
  });

  it('answers an unknown application address with a not-found screen inside the shell', async () => {
    const { appRoutes } = await import('./router');
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/setting'] });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Finish session' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    const shell = screen.getByRole('region', { name: 'Application shell' });
    expect(within(shell).getAllByRole('heading')).toEqual([heading]);
    expect(screen.getByText(/There is no page at this address/)).toBeInTheDocument();
    router.dispose();
  });
});
