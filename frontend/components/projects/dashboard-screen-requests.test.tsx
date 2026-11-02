import { screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { pendingOverviewHandlers, recordedProjectRead } from '@/test/fixtures/overview';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

const project = makeProject();
vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({ activeProject: project, isLoading: false }),
  useOptionalProjectContext: () => ({ activeProjectId: project.id }),
  useWorkspaceCapability: () => true,
  useActiveWorkspaceId: () => project.workspace_id,
}));

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

    renderWithProviders(<DashboardScreen />);

    await vi.waitFor(() =>
      expect([...asked].sort()).toEqual(['command-center', 'layout', 'prompts']),
    );
    // Still behind the command center: none of the Overview has painted.
    expect(screen.queryByRole('heading', { name: project.name })).not.toBeInTheDocument();
  });
});
