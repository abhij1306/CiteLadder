import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { SessionGuard, useSessionUser } from './session-guard';

const localUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'local@citeladder.local',
  role: 'admin',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function Protected() {
  const user = useSessionUser();
  return <div>working as {user.email}</div>;
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('SessionGuard', () => {
  it('renders the application for the local user', async () => {
    mswServer.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: localUser })));

    renderWithProviders(
      <SessionGuard fallback={<div>loading</div>}>
        <Protected />
      </SessionGuard>,
    );

    expect(await screen.findByText('working as local@citeladder.local')).toBeInTheDocument();
  });

  it('explains an unreachable API and recovers on retry', async () => {
    let failing = true;
    mswServer.use(
      http.get('/api/v1/auth/me', () =>
        failing
          ? // A 4xx is answered at once; a 5xx would sit through the query retries.
            HttpResponse.json({ error: { message: 'Not found' } }, { status: 404 })
          : HttpResponse.json({ user: localUser }),
      ),
    );

    renderWithProviders(
      <SessionGuard fallback={<div>loading</div>}>
        <Protected />
      </SessionGuard>,
    );

    expect(
      await screen.findByRole('heading', { name: 'CiteLadder could not reach its API' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/working as/)).toBeNull();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('working as local@citeladder.local')).toBeInTheDocument();
  });
});
