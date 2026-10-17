import { renderWithProviders as render } from '@/test/render';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { FailureScope, SelectionStatus } from '@/lib/project/selection';

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

type Role = 'owner' | 'admin' | 'member' | 'viewer';

let contextValue: {
  status: SelectionStatus;
  errorScope: FailureScope;
  activeWorkspaceId: string | null;
  activeWorkspace: { id: string; role: Role; capabilities: readonly string[] } | null;
  activeProjectId: string | null;
  retry: () => void;
};
vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => contextValue,
}));

import { OnboardingGate } from './onboarding-gate';

/** The effective capabilities each role publishes on the workspace row. */
const CAPABILITIES: Record<Role, readonly string[]> = {
  owner: ['manage_credentials', 'read', 'run', 'write'],
  admin: ['manage_credentials', 'read', 'run', 'write'],
  member: ['read', 'run', 'write'],
  viewer: ['read'],
};

function setContext(
  status: SelectionStatus,
  role: Role = 'owner',
  errorScope: FailureScope = null,
) {
  contextValue = {
    status,
    errorScope,
    activeWorkspaceId: WORKSPACE,
    activeWorkspace: { id: WORKSPACE, role, capabilities: CAPABILITIES[role] },
    activeProjectId: status === 'ready' ? PROJECT : null,
    retry: vi.fn(),
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

    // The workspace travels with the redirect: refreshing the creation route
    // must not silently change which workspace the project is created in.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/onboarding?workspace=${WORKSPACE}`, { replace: true }),
    );
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('does not redirect while the context is still resolving', () => {
    // An unsettled read is indistinguishable from "no projects" on length
    // alone. Redirecting here bounced existing users to onboarding for a frame.
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

    // An empty error result is never evidence that the account needs
    // onboarding — sending them there is what let a transient network failure
    // present as a brand new account.
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your workspace could not be loaded' }),
    ).toBeInTheDocument();
  });

  it('names the projects read when that is what failed', () => {
    // The workspace resolved; only the project list did not. Reporting a
    // workspace failure sends the reader after an access problem that is not
    // there.
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
    expect(screen.getByText('That project is unavailable')).toBeInTheDocument();
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

  it('renders an authorized project without a loader', () => {
    render(
      <OnboardingGate>
        <p>workspace</p>
      </OnboardingGate>,
    );

    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('page-loading')).not.toBeInTheDocument();
  });
});
