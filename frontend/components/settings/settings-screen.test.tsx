import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { BrowserRouter } from 'react-router-dom';

import { createAppQueryClient } from '@/lib/api/query-client';
import { makeProject } from '@/test/fixtures/project';

const { roleState } = vi.hoisted(() => ({ roleState: { mayDelete: true } }));

// Active project context — the danger zone deletes the active project.
const activeProject = makeProject({
  id: '00000000-0000-4000-8000-0000000000p1',
  workspace_id: '00000000-0000-4000-8000-0000000000w1',
  name: 'Acme Storage',
  brand_name: 'Acme',
});
const nextProject = {
  ...activeProject,
  id: '00000000-0000-4000-8000-0000000000p2',
  name: 'Beta Storage',
};
const setActiveProjectId = vi.fn();
vi.mock('@/lib/project/project-context', () => ({
  // Links keep the active project; this screen's links carry none.
  useOptionalProjectContext: () => null,
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  // Controls gate themselves on the caller's effective capability — an Owner here.
  useWorkspaceCapability: (capability: string) =>
    capability !== 'delete_projects' || roleState.mayDelete,
  useProjectContext: () => ({
    projects: [activeProject],
    activeProject,
    activeProjectId: activeProject.id,
    setActiveProjectId,
    activeWorkspace: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Test Workspace',
      role: 'owner',
      capabilities: ['manage_credentials', 'read', 'run', 'write'],
    },
    isLoading: false,
  }),
}));

const deleteProject = vi.fn().mockResolvedValue(undefined);
const listProjects = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api/projects', () => ({
  projectsApi: {
    deleteProject: (id: string) => deleteProject(id),
    listProjects: () => listProjects(),
  },
}));

// The Provider Settings tab fetches the catalog/connections; stub the panel so
// this suite stays focused on the tab shell (the panel has its own suite in
// provider-settings.test.tsx).
vi.mock('@/components/settings/provider-settings', () => ({
  ProviderSettings: () => <div data-testid="provider-settings-panel">provider settings</div>,
}));

// The Integrations tab fetches connections and owns the OAuth-callback notice;
// stub it the same way (its own suite is integration-settings.test.tsx).
vi.mock('@/components/settings/integration-settings', () => ({
  IntegrationSettings: () => <div data-testid="integration-settings-panel">integrations</div>,
}));

import { SettingsScreen } from './settings-screen';

function renderScreen() {
  return render(
    <BrowserRouter>
      <QueryClientProvider client={createAppQueryClient()}>
        <SettingsScreen />
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    deleteProject.mockClear();
    listProjects.mockReset();
    listProjects.mockResolvedValue([]);
    setActiveProjectId.mockClear();
    roleState.mayDelete = true;
    window.history.replaceState(null, '', '/settings');
  });

  it('shows the provider settings panel on the Provider Settings tab', async () => {
    const ue = userEvent.setup();
    renderScreen();

    // Panels stay mounted for stable aria-controls targets; inactive ones are hidden.
    expect(screen.getByTestId('provider-settings-panel')).not.toBeVisible();
    await ue.click(screen.getByRole('tab', { name: 'Providers' }));
    expect(screen.getByTestId('provider-settings-panel')).toBeVisible();
    // General content is hidden while another tab is active.
    const generalPanelId = screen
      .getByRole('tab', { name: 'General' })
      .getAttribute('aria-controls');
    expect(document.getElementById(generalPanelId ?? '')).toHaveAttribute('hidden');
  });

  it('opens the Provider Settings tab from a ?tab=providers deep link', () => {
    window.history.replaceState(null, '', '/settings?tab=providers');
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('provider-settings-panel')).toBeVisible();
  });

  it('opens the Integrations tab from a ?tab=integrations deep link (the C2 OAuth-callback landing)', () => {
    window.history.replaceState(null, '', '/settings?tab=integrations');
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Integrations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('integration-settings-panel')).toBeVisible();
    // The tab's aria-controls resolves to the mounted panel.
    const panelId = screen.getByRole('tab', { name: 'Integrations' }).getAttribute('aria-controls');
    expect(document.getElementById(panelId ?? '')).toContainElement(
      screen.getByTestId('integration-settings-panel'),
    );
  });

  it('shows the integrations panel when the Integrations tab is clicked', async () => {
    const ue = userEvent.setup();
    renderScreen();

    // Not mounted until selected: the panel owns a connection list that fans
    // out into per-connection queries and a 3s backfill poll, so mounting it
    // behind every other tab issued those requests for a reader on General.
    expect(screen.queryByTestId('integration-settings-panel')).toBeNull();
    await ue.click(screen.getByRole('tab', { name: 'Integrations' }));
    expect(screen.getByTestId('integration-settings-panel')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Integrations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('falls back to General on an unknown ?tab value', () => {
    window.history.replaceState(null, '', '/settings?tab=nonsense');
    renderScreen();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports arrow-key navigation across tabs', async () => {
    const ue = userEvent.setup();
    renderScreen();

    const general = screen.getByRole('tab', { name: 'General' });
    general.focus();
    await ue.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveAttribute('aria-selected', 'true');
    await ue.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'API keys' })).toHaveAttribute('aria-selected', 'true');
  });

  it('hides project deletion from a role that may not delete', () => {
    roleState.mayDelete = false;
    renderScreen();

    expect(screen.queryByRole('button', { name: /delete project/i })).not.toBeInTheDocument();
  });

  it('deletes the active project after confirmation', async () => {
    const ue = userEvent.setup();
    renderScreen();

    await ue.click(screen.getByRole('button', { name: /delete project/i }));
    const dialog = screen.getByRole('dialog', { name: 'Delete project' });
    await ue.click(within(dialog).getByRole('button', { name: 'Delete project' }));

    expect(deleteProject).toHaveBeenCalledWith(activeProject.id);
  });

  it('selects a project from the refreshed list after deletion', async () => {
    listProjects.mockResolvedValue([nextProject]);
    const ue = userEvent.setup();
    renderScreen();

    await ue.click(screen.getByRole('button', { name: /delete project/i }));
    const dialog = screen.getByRole('dialog', { name: 'Delete project' });
    await ue.click(within(dialog).getByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(setActiveProjectId).toHaveBeenCalledWith(nextProject.id));
    // The deleted project is replaced in-place, so Back cannot return to it.
    await waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        `/settings?project=${nextProject.id}`,
      ),
    );
  });
});
