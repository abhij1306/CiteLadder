import { describe, expect, it } from 'vite-plus/test';

import {
  hasPageTitle,
  isWorkspaceOnlyRoute,
  isAgentPath,
  navigationMode,
  projectSwitchPathname,
  recoveryRoute,
  resolveTitle,
} from './app-routes';
import { routeTrail } from './route-trail';

describe('app route manifest', () => {
  it('titles a page by its own route, else by the section it sits below', () => {
    expect(resolveTitle('/runs/1f0c')).toBe('Run');
    expect(resolveTitle('/site/crawls/c1/pages/p1')).toBe('Page detail');
    expect(resolveTitle('/agent/chats/c1')).toBe('Chat');
    expect(resolveTitle('/products/overview')).toBe('Shopping');
    expect(resolveTitle('/settings/unknown')).toBe('Settings');
    expect(resolveTitle('/nowhere')).toBe('CiteLadder');
  });

  it('sends a missing address back to the listed page it sits below, never to Overview', () => {
    expect(recoveryRoute('/runs/r1')).toEqual({ title: 'Runs', path: '/runs' });
    expect(recoveryRoute('/settings/unknown')).toEqual({ title: 'Settings', path: '/settings' });
    expect(recoveryRoute('/runs')).toBeUndefined();
    expect(recoveryRoute('/nowhere')).toBeUndefined();
  });

  it('gives only titled shell pages a loading frame', () => {
    expect(hasPageTitle('/issues')).toBe(true);
    expect(hasPageTitle('/settings')).toBe(true);
    expect(hasPageTitle('/onboarding')).toBe(false);
  });

  it('lets workspace pages render with no project and nothing else', () => {
    expect(isWorkspaceOnlyRoute('/settings')).toBe(true);
    expect(isWorkspaceOnlyRoute('/onboarding')).toBe(true);
    expect(isWorkspaceOnlyRoute('/prompts')).toBe(false);
    expect(isWorkspaceOnlyRoute(null)).toBe(false);
  });

  it('lands a project switch on the collection of a record the next project lacks', () => {
    expect(projectSwitchPathname('/runs/r1')).toBe('/runs');
    expect(projectSwitchPathname('/agent/chats/c1')).toBe('/agent');
    expect(projectSwitchPathname('/actions/a1')).toBe('/actions');
    expect(projectSwitchPathname('/site/crawls/c1/pages/p1')).toBe('/site');
    expect(projectSwitchPathname('/performance')).toBe('/performance');
  });

  it('trails a record page to its collection, and a top-level page or a chat nowhere', () => {
    expect(routeTrail('/runs/r1')).toEqual([{ label: 'Runs', href: '/runs' }]);
    expect(routeTrail('/site/crawls/c1/pages/p1')).toEqual([
      { label: 'Site health', href: '/site' },
    ]);
    expect(routeTrail('/prompts/abc')).toEqual([{ label: 'Prompts', href: '/prompts' }]);
    expect(routeTrail('/prompts/build')).toEqual([]);
    expect(routeTrail('/runs')).toEqual([]);
    expect(routeTrail('/agent/chats/c1')).toEqual([]);
  });

  it("tells the Agent's own pages, known or not, from every other page", () => {
    expect(isAgentPath('/agent')).toBe(true);
    expect(isAgentPath('/agent/unknown')).toBe(true);
    expect(isAgentPath('/agents-report')).toBe(false);
    expect(isAgentPath('/prompts')).toBe(false);
  });

  it.each([
    ['/agent', 'agent'],
    ['/agent/chats/c1', 'agent'],
    ['/agent/skills', 'agent'],
    ['/agent/context', 'agent'],
    ['/actions', 'dashboard'],
    ['/actions/a1', 'dashboard'],
    ['/projects', 'dashboard'],
    ['/site/crawls/c1/pages/p1', 'dashboard'],
    ['/products/overview', 'dashboard'],
    ['/agents-report', 'dashboard'],
    ['/settings', 'dashboard'],
  ] as const)('puts %s in %s mode', (pathname, mode) => {
    expect(navigationMode(pathname)).toBe(mode);
  });
});
