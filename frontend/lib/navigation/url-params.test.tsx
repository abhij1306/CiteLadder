import { describe, expect, it } from 'vite-plus/test';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { useSetUrlParams, useUrlParam, withUrlParams, type UrlParamValues } from './url-params';

describe('withUrlParams', () => {
  it('encodes flags, deletes nulls and keeps unnamed params in place', () => {
    const current = new URLSearchParams('tab=links&links_page=3&links_q=old');
    const next = withUrlParams(current, { links_q: 'anchor', links_page: null, new: true });
    expect(next.toString()).toBe('tab=links&links_q=anchor&new=1');
    expect(withUrlParams(next, { new: false }).toString()).toBe('tab=links&links_q=anchor');
    expect(current.toString()).toBe('tab=links&links_page=3&links_q=old');
  });
});

describe('useSetUrlParams', () => {
  it('writes through the router so typed reads see the new value', async () => {
    let write: (values: UrlParamValues) => void = () => undefined;
    function Probe() {
      const rerun = useUrlParam('rerun');
      const link = useUrlParam('link');
      write = useSetUrlParams();
      return <output>{`${rerun}:${link ?? 'none'}`}</output>;
    }
    const router = createMemoryRouter([{ path: '/site', element: <Probe /> }], {
      initialEntries: ['/site?link=l1&rerun=1'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('status')).toHaveTextContent('true:l1');

    await act(async () => write({ link: null, rerun: false }));

    expect(screen.getByRole('status')).toHaveTextContent('false:none');
    expect(router.state.location.search).toBe('');
  });
});
