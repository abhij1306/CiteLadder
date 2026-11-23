import { screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { pendingOverviewHandlers, recordedProjectRead } from '@/test/fixtures/overview';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { projectScope, renderWithProviders } from '@/test/render';

const project = makeProject();

import { DashboardScreen } from './dashboard-screen';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Overview opening requests', () => {
  it('asks for the layout and its widgets while the command center is still loading', async () => {
    const asked: string[] = [];
    mswServer.use(
      ...pendingOverviewHandlers(project.id, ['project_state', 'missing_prompts'], asked),
      recordedProjectRead(project.id, 'visibility/prompts', 'prompts', asked, []),
    );

    renderWithProviders(<DashboardScreen />, { projectSelection: projectScope(project) });

    await vi.waitFor(() =>
      expect([...asked].sort()).toEqual(['command-center', 'layout', 'prompts']),
    );
    expect(screen.queryByRole('heading', { name: project.name })).not.toBeInTheDocument();
  });
});
