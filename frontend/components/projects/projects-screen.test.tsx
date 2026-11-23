import { screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders, selectionAs, type TestRole } from '@/test/render';
import { ProjectsScreen } from './projects-screen';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function renderProjects({
  projects,
  role = 'owner',
}: {
  projects: ReturnType<typeof makeProject>[];
  role?: TestRole;
}) {
  return renderWithProviders(
    <>
      <ProjectsScreen />
      <Location />
    </>,
    {
      initialEntries: ['/projects'],
      projectSelection: { ...selectionAs(role), projects },
    },
  );
}

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

vi.mock('./dashboard-screen', () => ({
  DashboardScreen: ({ onEditProject }: { onEditProject?: (project: unknown) => void }) => (
    <div>
      Project dashboard
      {onEditProject ? <button type="button">Edit project</button> : null}
    </div>
  ),
}));

describe('ProjectsScreen', () => {
  it('sends the empty-workspace creation action to the new-project flow', async () => {
    renderProjects({ projects: [] });
    const button = screen.getByRole('button', { name: 'Add project' });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/onboarding?new=1&workspace=${WORKSPACE}`,
    );
  });

  it('offers a Viewer neither project editing nor project creation', () => {
    const view = renderProjects({ projects: [makeProject()], role: 'viewer' });
    expect(screen.getByText('Project dashboard')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit project' })).toBeNull();
    view.unmount();

    renderProjects({ projects: [], role: 'viewer' });
    expect(screen.getByText('No projects yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull();
  });
});
