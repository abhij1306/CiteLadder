import { http, HttpResponse } from 'msw';
import { expect, it } from 'vite-plus/test';
import { screen } from '@testing-library/react';

import { mswServer } from '@/test/msw-server';
import { testWorkspace } from '@/test/render';
import { mockRoutes, renderScreen } from './site-health-screen.test-support';

it('shows a viewer the crawl without any control to start, stop or schedule one', async () => {
  mockRoutes();
  mswServer.use(http.get('/api/v1/workspaces', () => HttpResponse.json([testWorkspace('viewer')])));

  renderScreen();

  expect(await screen.findByTestId('status-strip')).toBeVisible();
  expect(screen.getByRole('tablist', { name: 'Website analysis' })).toBeVisible();
  for (const name of ['Run new crawl', 'Stop crawl', 'Rerun', /schedule/i])
    expect(screen.queryByRole('button', { name })).toBeNull();
});

it('offers an Owner the same crawl with its controls', async () => {
  mockRoutes();

  renderScreen();

  expect(await screen.findByRole('button', { name: 'Run new crawl' })).toBeVisible();
});
