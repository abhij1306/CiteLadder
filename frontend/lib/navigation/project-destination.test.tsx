import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { isAppRoute } from './app-route';

const navigate = vi.fn();
let pathname = '/projects';
let search = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname }),
  useNavigate: () => navigate,
  useSearchParams: () => [search, vi.fn()],
}));

const setActiveProjectId = vi.fn();
const setActiveWorkspaceId = vi.fn();
let activeProjectId: string | null = null;
vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({
    activeProjectId,
    setActiveProjectId,
    activeWorkspaceId: WORKSPACE,
    setActiveWorkspaceId,
  }),
}));

import {
  newProjectDestination,
  projectDestination,
  scopedNavigationDestination,
  useSelectProject,
  useSelectWorkspace,
  workspaceDestination,
} from './project-destination';

const PROJECT_1 = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  navigate.mockClear();
  setActiveProjectId.mockClear();
  pathname = '/projects';
  search = new URLSearchParams();
  activeProjectId = null;
});

describe('projectDestination', () => {
  it('keeps the destination parameters and drops the workspace', () => {
    const href = projectDestination(
      '/visibility',
      new URLSearchParams({ tab: 'sources', workspace: WORKSPACE }),
      PROJECT_1,
    );
    expect(href).toBe(`/visibility?tab=sources&project=${PROJECT_1}`);
  });
});

describe('workspaceDestination', () => {
  it('names the workspace on a route that has no project to identify itself', () => {
    expect(workspaceDestination('/onboarding', new URLSearchParams({ new: '1' }), WORKSPACE)).toBe(
      `/onboarding?new=1&workspace=${WORKSPACE}`,
    );
  });
});

describe('newProjectDestination', () => {
  it('keeps every additional-project flow in the active workspace', () => {
    expect(newProjectDestination(WORKSPACE)).toBe(`/onboarding?new=1&workspace=${WORKSPACE}`);
  });
});

describe('scopedNavigationDestination', () => {
  it('adds project identity to project routes and workspace identity to shared routes', () => {
    expect(scopedNavigationDestination('/runs#history', 'project', PROJECT_1, WORKSPACE)).toBe(
      `/runs?project=${PROJECT_1}#history`,
    );
    expect(
      scopedNavigationDestination(
        '/settings?tab=providers#credentials',
        'workspace',
        PROJECT_1,
        WORKSPACE,
      ),
    ).toBe(`/settings?tab=providers&workspace=${WORKSPACE}#credentials`);
  });

  it('rejects browser-normalized external and scheme destinations', () => {
    for (const href of [
      'javascript:alert(1)',
      'https://example.com',
      '//example.com/path',
      '/\\example.com/path',
      '/\n/example.com/path',
    ]) {
      expect(isAppRoute(href)).toBe(false);
      expect(() => scopedNavigationDestination(href, 'project', PROJECT_1, WORKSPACE)).toThrow();
    }
    expect(isAppRoute('/runs?tab=history#details')).toBe(true);
  });
});

describe('useSelectProject', () => {
  it('pushes one entry for a deliberate switch, so Back returns to the previous project', () => {
    activeProjectId = PROJECT_1;
    search = new URLSearchParams({ project: PROJECT_1 });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2));

    expect(setActiveProjectId).toHaveBeenCalledWith(PROJECT_2);
    expect(navigate).toHaveBeenCalledWith(`/projects?project=${PROJECT_2}`);
  });

  it('replaces when it is only filling in an absent parameter', () => {
    activeProjectId = PROJECT_1;
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_1));

    expect(navigate).toHaveBeenCalledWith(`/projects?project=${PROJECT_1}`, {
      replace: true,
      preventScrollReset: true,
    });
  });

  it('adds no history entry for the project already in the URL', () => {
    activeProjectId = PROJECT_1;
    search = new URLSearchParams({ project: PROJECT_1 });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_1));
    const calls = [...navigate.mock.calls];
    act(() => result.current(PROJECT_2));

    expect([calls, navigate.mock.calls]).toEqual([[], [[`/projects?project=${PROJECT_2}`]]]);
  });

  it('replaces when the entry being left behind is dead', () => {
    activeProjectId = PROJECT_1;
    search = new URLSearchParams({ project: PROJECT_1 });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2, { replace: true }));

    expect(navigate).toHaveBeenCalledWith(`/projects?project=${PROJECT_2}`, {
      replace: true,
      preventScrollReset: true,
    });
  });

  it('pushes when the selection also changes page', () => {
    activeProjectId = PROJECT_1;
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_1, { destination: '/settings' }));

    expect(navigate).toHaveBeenCalledWith(`/settings?project=${PROJECT_1}`);
  });

  it('leaves a path that names the outgoing project crawl', () => {
    activeProjectId = PROJECT_1;
    pathname = '/site/crawls/22222222-2222-4222-8222-222222222222/pages/abc';
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2));

    expect(navigate).toHaveBeenCalledWith(`/site?project=${PROJECT_2}`);
  });

  it("leaves the outgoing project's prompt for the new project's prompt library", () => {
    activeProjectId = PROJECT_1;
    pathname = '/prompts/22222222-2222-4222-8222-222222222222';
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2));

    expect(navigate).toHaveBeenCalledWith(`/prompts?project=${PROJECT_2}`);
  });

  it('keeps a path that names no project-owned resource', () => {
    activeProjectId = PROJECT_1;
    pathname = '/issues';
    search = new URLSearchParams({ section: 'content', sort: 'pages' });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2));

    expect(navigate).toHaveBeenCalledWith(
      `/issues?section=content&sort=pages&project=${PROJECT_2}`,
    );
  });

  it("drops the outgoing project's record ids and keeps its view", () => {
    activeProjectId = PROJECT_1;
    pathname = '/visibility';
    search = new URLSearchParams({
      project: PROJECT_1,
      tab: 'sources',
      run: 'run-of-project-1',
      prompt: 'prompt-of-project-1',
    });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2));

    expect(navigate).toHaveBeenCalledWith(`/visibility?tab=sources&project=${PROJECT_2}`);
  });

  it('keeps record ids when the active project is re-selected', () => {
    activeProjectId = PROJECT_1;
    pathname = '/issues';
    search = new URLSearchParams({ issue: 'group-1' });
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_1));

    expect(navigate).toHaveBeenCalledWith(`/issues?issue=group-1&project=${PROJECT_1}`, {
      replace: true,
      preventScrollReset: true,
    });
  });

  it('keeps a crawl detail path when the ACTIVE project is re-selected', () => {
    activeProjectId = PROJECT_1;
    pathname = '/site/crawls/22222222-2222-4222-8222-222222222222/pages/abc';
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_1));

    expect(navigate).toHaveBeenCalledWith(`${pathname}?project=${PROJECT_1}`, {
      replace: true,
      preventScrollReset: true,
    });
  });

  it('keeps an explicit destination even when leaving a crawl detail path', () => {
    activeProjectId = PROJECT_1;
    pathname = '/site/crawls/22222222-2222-4222-8222-222222222222/pages/abc';
    const { result } = renderHook(() => useSelectProject());

    act(() => result.current(PROJECT_2, { destination: '/settings' }));

    expect(navigate).toHaveBeenCalledWith(`/settings?project=${PROJECT_2}`);
  });
});

describe('useSelectWorkspace', () => {
  const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const switchFrom = (path: string, params: Record<string, string> = {}) => {
    pathname = path;
    search = new URLSearchParams(params);
    navigate.mockClear();
    const { result } = renderHook(() => useSelectWorkspace());
    act(() => result.current(OTHER));
    return navigate.mock.calls.at(-1)?.[0];
  };

  it('stays on the page, dropping record ids, and lands on Overview from a path no screen owns', () => {
    expect(switchFrom('/insights', { project: PROJECT_1, tab: 'trend', run: 'r1' })).toBe(
      `/insights?tab=trend&workspace=${OTHER}`,
    );
    expect(switchFrom(`/prompts/${PROJECT_2}`)).toBe(`/prompts?workspace=${OTHER}`);
    expect(switchFrom('/settings')).toBe(`/settings?workspace=${OTHER}`);
    expect(switchFrom('/no-such-page')).toBe(`/projects?workspace=${OTHER}`);
    expect(switchFrom(`/prompts/${PROJECT_2}/extra`)).toBe(`/projects?workspace=${OTHER}`);
  });

  it('does nothing when the active workspace is picked again', () => {
    pathname = '/insights';
    const { result } = renderHook(() => useSelectWorkspace());
    act(() => result.current(WORKSPACE));
    expect(navigate).not.toHaveBeenCalled();
    act(() => result.current(OTHER));
    expect(navigate).toHaveBeenCalledWith(`/insights?workspace=${OTHER}`);
  });
});
