import { describe, expect, it } from 'vite-plus/test';

import type { Project, Workspace } from '@/lib/api/types';

import {
  pickActiveProject,
  resolveFailureScope,
  resolveProjectId,
  resolveStatus,
  resolveWorkspaceId,
} from './selection';

const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_1 = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';

const workspace = (id: string) => ({ id }) as Workspace;
const project = (id: string, workspaceId = WORKSPACE_A) =>
  ({ id, workspace_id: workspaceId }) as Project;

describe('resolveWorkspaceId', () => {
  const base = {
    projectWorkspaceId: null,
    urlWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaces: [workspace(WORKSPACE_A), workspace(WORKSPACE_B)],
  };

  it('lets an authorized project decide its own workspace', () => {
    // The project has already been membership-checked by the server, so its
    // workspace outranks anything the URL or the device remembers.
    expect(
      resolveWorkspaceId({
        ...base,
        projectWorkspaceId: WORKSPACE_B,
        urlWorkspaceId: WORKSPACE_A,
        selectedWorkspaceId: WORKSPACE_A,
      }),
    ).toBe(WORKSPACE_B);
  });

  it('prefers an explicit URL workspace over the remembered one', () => {
    expect(
      resolveWorkspaceId({
        ...base,
        urlWorkspaceId: WORKSPACE_B,
        selectedWorkspaceId: WORKSPACE_A,
      }),
    ).toBe(WORKSPACE_B);
  });

  it('discards a candidate the membership list does not contain', () => {
    // Storage and URLs are conveniences. The list is the only authority, so a
    // workspace the reader has been removed from resolves to one they have.
    expect(resolveWorkspaceId({ ...base, selectedWorkspaceId: 'gone' })).toBe(WORKSPACE_A);
  });

  it('trusts a remembered workspace provisionally while the list loads', () => {
    // This is what lets a returning reader's scoped requests start in the same
    // render as `me` rather than a round trip later; the backend still
    // membership-checks every one of them.
    expect(
      resolveWorkspaceId({ ...base, workspaces: undefined, selectedWorkspaceId: WORKSPACE_B }),
    ).toBe(WORKSPACE_B);
  });

  it('falls back to the first membership with nothing to go on', () => {
    expect(resolveWorkspaceId(base)).toBe(WORKSPACE_A);
  });
});

describe('resolveProjectId', () => {
  it('never substitutes an explicit id, even against a settled list without it', () => {
    // The creation race: the list was fetched before the project existed.
    expect(
      resolveProjectId({
        requestedProjectId: PROJECT_2,
        selectedProjectId: null,
        projects: [project(PROJECT_1)],
        listSettled: true,
      }),
    ).toBe(PROJECT_2);
  });

  it('holds a remembered selection while the list is unsettled', () => {
    expect(
      resolveProjectId({
        requestedProjectId: null,
        selectedProjectId: PROJECT_2,
        projects: [],
        listSettled: false,
      }),
    ).toBe(PROJECT_2);
  });

  it('releases a remembered selection a settled list has dropped', () => {
    expect(
      resolveProjectId({
        requestedProjectId: null,
        selectedProjectId: PROJECT_2,
        projects: [project(PROJECT_1)],
        listSettled: true,
      }),
    ).toBe(PROJECT_1);
  });

  it('is null when the workspace genuinely has none', () => {
    expect(
      resolveProjectId({
        requestedProjectId: null,
        selectedProjectId: null,
        projects: [],
        listSettled: true,
      }),
    ).toBeNull();
  });
});

describe('pickActiveProject', () => {
  it('prefers the directly-resolved project over the list copy', () => {
    const resolved = project(PROJECT_1);
    expect(pickActiveProject(resolved, [project(PROJECT_1)], PROJECT_1)).toBe(resolved);
  });

  it('ignores a resolved project that is no longer the active one', () => {
    expect(pickActiveProject(project(PROJECT_2), [project(PROJECT_1)], PROJECT_1)?.id).toBe(
      PROJECT_1,
    );
  });
});

describe('resolveStatus', () => {
  const base = {
    contradictoryRequest: false,
    requestedProjectPending: false,
    requestedProjectMissing: false,
    failed: false,
    noWorkspace: false,
    workspaceId: WORKSPACE_A,
    activeProjectId: PROJECT_1,
    hasResolvedProject: true,
    listSettled: true,
  };

  it('ranks a confirmed absence above a failure', () => {
    expect(resolveStatus({ ...base, requestedProjectMissing: true, failed: true })).toBe(
      'unavailable',
    );
  });

  it('ranks a failure above still-working', () => {
    expect(
      resolveStatus({ ...base, failed: true, hasResolvedProject: false, listSettled: false }),
    ).toBe('error');
  });

  it('keeps a resolved project usable while the list reconciles', () => {
    // Holding the shell for a refetch that only confirms what is already known
    // is what made a brand new project look absent.
    expect(resolveStatus({ ...base, listSettled: false })).toBe('ready');
  });

  it('is resolving, never empty, before the list settles', () => {
    expect(
      resolveStatus({
        ...base,
        hasResolvedProject: false,
        activeProjectId: null,
        listSettled: false,
      }),
    ).toBe('resolving');
  });

  it('holds at resolving while an explicit project is still being fetched', () => {
    // The requested id becomes the active id immediately, so a workspace list
    // that settles first would otherwise report `ready` with no active project
    // and let a screen render against a project still in flight.
    expect(
      resolveStatus({ ...base, requestedProjectPending: true, hasResolvedProject: false }),
    ).toBe('resolving');
  });

  it('fails safe to resolving for an id with no project behind it', () => {
    expect(resolveStatus({ ...base, hasResolvedProject: false, activeProjectId: PROJECT_1 })).toBe(
      'resolving',
    );
  });

  it('sends someone who belongs to no workspace to set one up, unless a read failed', () => {
    const none = { ...base, noWorkspace: true, workspaceId: null, hasResolvedProject: false };
    expect(resolveStatus({ ...none, activeProjectId: null, listSettled: false })).toBe(
      'no_workspace',
    );
    expect(resolveStatus({ ...none, failed: true })).toBe('error');
  });

  it('is empty only once a settled list says so', () => {
    expect(resolveStatus({ ...base, hasResolvedProject: false, activeProjectId: null })).toBe(
      'empty',
    );
  });
});

describe('resolveFailureScope', () => {
  const none = {
    detailFailed: false,
    membershipFailed: false,
    listFailedWithNothingUsable: false,
  };

  it('blames membership first: without it the project reads never had a chance', () => {
    expect(
      resolveFailureScope({ ...none, membershipFailed: true, listFailedWithNothingUsable: true }),
    ).toBe('workspace');
  });

  it('names the projects read when the workspace resolved fine', () => {
    expect(resolveFailureScope({ ...none, listFailedWithNothingUsable: true })).toBe('projects');
    expect(resolveFailureScope({ ...none, detailFailed: true })).toBe('projects');
  });

  it('is null when nothing failed', () => {
    expect(resolveFailureScope(none)).toBeNull();
  });
});
