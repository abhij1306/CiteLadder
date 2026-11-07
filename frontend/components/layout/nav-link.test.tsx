import { render, screen } from '@testing-library/react';
import { ListChecks } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { NavLink } from './nav-link';

vi.mock('./open-action-count', () => ({
  OpenActionCount: () => {
    throw new TypeError("Cannot read properties of undefined (reading 'open')");
  },
}));

const sink = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve(new Response(null, { status: 204 })),
);

beforeEach(() => {
  vi.stubGlobal('fetch', sink);
  // React reports the caught error; the assertions are on what renders and is sent.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Navigation row', () => {
  it('keeps the row when its count throws while rendering, and reports the defect', async () => {
    render(
      <MemoryRouter>
        <nav aria-label="Main">
          <NavLink
            item={{
              label: 'Actions',
              href: '/agent/actions',
              icon: ListChecks,
              badge: 'open-actions',
              scope: 'project',
            }}
            active={false}
            onIntent={() => {}}
          />
        </nav>
      </MemoryRouter>,
    );

    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('link', { name: 'Actions' })).toHaveAttribute('href', '/agent/actions');
    const [url, init] = sink.mock.calls[0]!;
    expect(url).toBe('/api/v1/client-errors');
    expect(JSON.parse(String(init.body))).toMatchObject({
      kind: 'render',
      message: "Cannot read properties of undefined (reading 'open')",
      component: 'open-action-count',
    });
  });
});
