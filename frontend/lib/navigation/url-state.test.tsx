import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  createBrowserRouter,
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useSearchParams,
} from 'react-router-dom';

import { AppScrollRestoration } from '@/components/layout/app-scroll-restoration';

import {
  batchUrlWrites,
  optionalStringUrlCodec,
  readUrlState,
  setUrlParams,
  setUrlStateRouter,
  sortUrlCodec,
  stringUrlCodec,
  subscribeToUrlState,
} from './url-state';

beforeEach(() => window.history.replaceState(null, '', '/projects'));
afterEach(() => setUrlStateRouter(null));

describe('URL state codecs', () => {
  it('canonicalizes invalid enums to the default and omits that default', () => {
    const codec = stringUrlCodec(['overview', 'issues'] as const, 'overview');
    expect(codec.parse('issues')).toBe('issues');
    expect(codec.parse('unknown')).toBe('overview');
    expect(codec.serialize('overview')).toBeNull();
    expect(codec.serialize('issues')).toBe('issues');
  });

  it('reads a sort as a key with a leading minus for descending, leaving out the default', () => {
    const codec = sortUrlCodec(['created', 'failed'] as const, {
      key: 'created',
      descending: true,
    });
    expect(codec.parse('-failed')).toEqual({ key: 'failed', descending: true });
    expect(codec.parse('failed')).toEqual({ key: 'failed', descending: false });
    expect(codec.parse('-unknown')).toEqual({ key: 'created', descending: true });
    expect(codec.serialize({ key: 'created', descending: false })).toBe('created');
    expect(codec.serialize({ key: 'created', descending: true })).toBeNull();
  });

  it('round-trips optional selected IDs', () => {
    expect(optionalStringUrlCodec.parse('issue-id')).toBe('issue-id');
    expect(optionalStringUrlCodec.serialize(null)).toBeNull();
  });

  it('preserves unrelated scope and hash while avoiding duplicate history entries', () => {
    window.history.replaceState(null, '', '/opportunities?project=project-id&keep=1#evidence');
    const push = vi.spyOn(window.history, 'pushState');

    setUrlParams({ selected: 'opportunity-id' });
    expect(window.location.href).toContain(
      '/opportunities?project=project-id&keep=1&selected=opportunity-id#evidence',
    );
    expect(push).toHaveBeenCalledOnce();

    setUrlParams({ selected: 'opportunity-id' });
    expect(push).toHaveBeenCalledOnce();
    push.mockRestore();
  });

  it('does not add history for an equivalent query encoding', () => {
    window.history.replaceState(null, '', '/opportunities?query=one%20two');
    const push = vi.spyOn(window.history, 'pushState');

    setUrlParams({ query: 'one two' });
    const equivalent = push.mock.calls.length;
    setUrlParams({ query: 'one three' });

    expect([equivalent, push.mock.calls.length, window.location.search]).toEqual([
      0,
      1,
      '?query=one+three',
    ]);
    push.mockRestore();
  });
});

describe('address store', () => {
  it('notifies subscribers even when a read has already observed the change', () => {
    window.history.replaceState(null, '', '/issues?severity=low');
    const seen: string[] = [];
    const unsubscribe = subscribeToUrlState(() => seen.push(readUrlState()));

    window.history.replaceState(null, '', '/issues?severity=high');
    expect(readUrlState()).toContain('severity=high');

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seen).toEqual([expect.stringContaining('severity=high')]);

    unsubscribe();
  });

  it('notifies a new subscriber of a write back to an address it moved away from unwatched', () => {
    window.history.replaceState(null, '', '/demand');
    const first = subscribeToUrlState(() => undefined);
    setUrlParams({ view: 'trends' });
    first();

    window.history.replaceState(null, '', '/demand');
    const seen: string[] = [];
    const second = subscribeToUrlState(() => seen.push(readUrlState()));

    setUrlParams({ view: 'trends' });
    expect(seen).toEqual([expect.stringContaining('view=trends')]);

    second();
  });
});

describe('router registration', () => {
  function Probe() {
    const [params] = useSearchParams();
    return <output data-testid="search">{params.toString()}</output>;
  }

  it('makes a filter write visible to useSearchParams in the same tree', async () => {
    window.history.replaceState(null, '', '/issues?project=p1');
    const router = createMemoryRouter([{ path: '/issues', element: <Probe /> }], {
      initialEntries: ['/issues?project=p1'],
    });
    setUrlStateRouter(router);
    render(<RouterProvider router={router} />);

    expect(screen.getByTestId('search')).toHaveTextContent('project=p1');

    setUrlParams({ severity: 'medium' });

    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('severity=medium'));
    expect(screen.getByTestId('search')).toHaveTextContent('project=p1');
  });

  it('opens a new visit at the top, restores only on Back, and keeps position on a filter write', async () => {
    window.history.replaceState(null, '', '/site');
    const router = createBrowserRouter([
      {
        element: (
          <>
            <AppScrollRestoration />
            <main id="main">
              <Outlet />
            </main>
          </>
        ),
        children: [
          { path: '/site', element: <p>site</p> },
          { path: '/issues', element: <p>issues</p> },
        ],
      },
    ]);
    setUrlStateRouter(router);
    render(<RouterProvider router={router} />);
    const panel = document.getElementById('main')!;
    let scrollTop = 0;
    Object.defineProperty(panel, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => (scrollTop = value),
    });
    const scrollPanelTo = (top: number) => {
      scrollTop = top;
      panel.dispatchEvent(new Event('scroll'));
    };
    const positions: number[] = [];

    scrollPanelTo(600);
    await act(() => router.navigate('/issues'));
    positions.push(scrollTop);
    await act(() => router.navigate('/site'));
    positions.push(scrollTop);
    scrollPanelTo(300);
    await act(async () => setUrlParams({ tab: 'pages' }));
    positions.push(scrollTop);
    await act(() => router.navigate(-3));
    positions.push(scrollTop);

    expect(positions).toEqual([0, 0, 300, 600]);
    scrollPanelTo(200);
    await act(() => router.navigate('/issues#%'));
    expect(scrollTop).toBe(0);
    router.dispose();
  });

  it('lands every write of a batch through the router, as one history entry', async () => {
    window.history.replaceState(null, '', '/issues?project=p1&severity=low&kind=faq');
    const router = createMemoryRouter([{ path: '/issues', element: <Probe /> }], {
      initialEntries: ['/issues?project=p1&severity=low&kind=faq'],
    });
    setUrlStateRouter(router);
    const navigate = vi.spyOn(router, 'navigate');
    render(<RouterProvider router={router} />);

    batchUrlWrites(() => {
      setUrlParams({ severity: null });
      setUrlParams({ kind: null });
    });

    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('project=p1'));
    expect(navigate).toHaveBeenCalledOnce();
    await act(() => router.navigate(-1));
    expect(screen.getByTestId('search').textContent).toBe('project=p1&severity=low&kind=faq');
    router.dispose();
  });

  it('replaces the entry for a batch whose every write replaces', () => {
    window.history.replaceState(null, '', '/actions?impact=high&source=seo');
    const push = vi.spyOn(window.history, 'pushState');
    batchUrlWrites(() => {
      setUrlParams({ impact: null }, 'replace');
      setUrlParams({ source: null }, 'replace');
    });
    expect(window.location.search).toBe('');
    expect(push).not.toHaveBeenCalled();
    batchUrlWrites(() => {
      setUrlParams({ impact: 'low' }, 'replace');
      setUrlParams({ source: 'aeo' });
    });
    expect(push).toHaveBeenCalledOnce();
    push.mockRestore();
  });

  it('falls back to history when nothing has registered a router', () => {
    window.history.replaceState(null, '', '/issues?project=p1');
    const push = vi.spyOn(window.history, 'pushState');
    setUrlParams({ severity: 'low' });
    expect(push).toHaveBeenCalledOnce();
    expect(window.location.search).toContain('severity=low');
    push.mockRestore();
  });
});
