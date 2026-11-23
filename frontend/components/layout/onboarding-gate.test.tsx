import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { ProjectSelectionProvider, type ProjectContextValue } from '@/lib/project/project-scope';
import { makeProject } from '@/test/fixtures/project';
import type { FailureScope, SelectionStatus } from '@/lib/project/selection';
import {
  renderWithProviders,
  testProjectSelection,
  testWorkspace,
  type TestRole,
} from '@/test/render';

const replace = vi.fn();
let pathname = '/projects';
let search = new URLSearchParams();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLocation: () => ({ pathname }),
  useNavigate: () => replace,
  useSearchParams: () => [search],
}));

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';

let selection: Partial<ProjectContextValue>;

import { OnboardingGate } from './onboarding-gate';

function render(ui: ReactElement) {
  return renderWithProviders(ui, { projectSelection: selection });
}

function setContext(
  status: SelectionStatus,
  role: TestRole = 'owner',
  errorScope: FailureScope = null,
) {
  const workspace = testWorkspace(role);
  selection = {
    status,
    errorScope,
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeWorkspace: workspace,
    activeProjectId: status === 'ready' ? PROJECT : null,
    activeProject:
      status === 'ready' ? makeProject({ id: PROJECT, workspace_id: WORKSPACE }) : null,
  };
}

beforeEach(() => {
  replace.mockClear();
  pathname = '/projects';
  search = new URLSearchParams();
  setContext('ready');
});

describe('OnboardingGate', () => {
  it('renders the app while replacing a bare project route with its canonical URL', async () => {
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(screen.getByText('workspace')).toBeInTheDocument();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/projects?project=${PROJECT}`, {
        replace: true,
        preventScrollReset: true,
      }),
    );
  });

  it('does not navigate when the URL already names the resolved project', () => {
    search = new URLSearchParams({ project: PROJECT });
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends an empty workspace to onboarding, carrying the workspace', async () => {
    setContext('empty');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/onboarding?workspace=${WORKSPACE}`, { replace: true }),
    );
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('does not redirect while the context is still resolving', () => {
    setContext('resolving');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('offers a retry instead of onboarding when a read failed', () => {
    setContext('error', 'owner', 'workspace');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your workspace could not be loaded' }),
    ).toBeInTheDocument();
  });

  it('names the projects read when that is what failed', () => {
    setContext('error', 'owner', 'projects');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(
      screen.getByRole('heading', { name: 'Projects could not be loaded' }),
    ).toBeInTheDocument();
  });

  it('names a missing project rather than substituting another one', () => {
    setContext('unavailable');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'That project is unavailable' }),
    ).toBeInTheDocument();
  });

  it('hands a project route its resolved project scope', () => {
    search = new URLSearchParams({ project: PROJECT });
    function ScopedScreen() {
      const { workspaceId, projectId } = useProjectScope();
      return <p>{`${workspaceId}/${projectId}`}</p>;
    }
    render(
      <OnboardingGate>
        <ScopedScreen />
      </OnboardingGate>,
    );

    expect(screen.getByText(`${WORKSPACE}/${PROJECT}`)).toBeInTheDocument();
  });

  it('starts a project route afresh on a project switch, so no draft carries over', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    function DraftScreen() {
      const { projectId } = useProjectScope();
      const [draft, setDraft] = useState('');
      return (
        <label>
          {`Draft for ${projectId}`}
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
      );
    }
    const gate = (value: Partial<ProjectContextValue>) => (
      <ProjectSelectionProvider value={testProjectSelection(value)}>
        <OnboardingGate>
          <DraftScreen />
        </OnboardingGate>
      </ProjectSelectionProvider>
    );
    const { rerender } = render(gate(selection));
    await userEvent.type(screen.getByLabelText(`Draft for ${PROJECT}`), 'weekly');
    expect(screen.getByLabelText(`Draft for ${PROJECT}`)).toHaveValue('weekly');

    rerender(
      gate({
        ...selection,
        activeProjectId: OTHER,
        activeProject: makeProject({ id: OTHER, workspace_id: WORKSPACE }),
      }),
    );

    expect(screen.getByLabelText(`Draft for ${OTHER}`)).toHaveValue('');
  });

  it('keeps an empty workspace on its workspace-management routes', () => {
    // A workspace with no projects is still a workspace: its settings stay
    // reachable, and redirecting them to project creation made an empty
    // workspace unmanageable.
    pathname = '/settings';
    setContext('empty');
    render(
      <OnboardingGate>
        <p>settings</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('settings')).toBeInTheDocument();
  });

  it('preserves the workspace-scoped additional-project onboarding URL', () => {
    pathname = '/onboarding';
    search = new URLSearchParams({ new: '1', workspace: WORKSPACE });

    render(
      <OnboardingGate>
        <p>onboarding</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('onboarding')).toBeInTheDocument();
  });

  it('does not loop a Viewer through a creation flow that would refuse them', () => {
    setContext('empty', 'viewer');
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('You have read-only access to this workspace.')).toBeInTheDocument();
  });

  it('renders an authorized project without a loader', async () => {
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(screen.getByText('workspace')).toBeInTheDocument();
    await act(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, LOADING_INDICATOR_DELAY_MS);
        }),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('workspace')).toBeInTheDocument();
  });
});
