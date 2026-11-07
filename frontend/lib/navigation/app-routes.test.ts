import { describe, expect, it } from 'vite-plus/test';

import {
  hasPageTitle,
  isWorkspaceOnlyRoute,
  navigationMode,
  projectSwitchPathname,
  resolveTitle,
} from './app-routes';

describe('app route manifest', () => {
  it('titles a page by its own route, else by the section it sits below', () => {
    expect(resolveTitle('/runs/1f0c')).toBe('Run detail');
    expect(resolveTitle('/site/crawls/c1/pages/p1')).toBe('Page detail');
    expect(resolveTitle('/agent/chats/c1')).toBe('Agent');
    expect(resolveTitle('/settings/unknown')).toBe('Settings');
    expect(resolveTitle('/nowhere')).toBe('CiteLadder');
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
    expect(projectSwitchPathname('/agent/actions/a1')).toBe('/agent/actions');
    expect(projectSwitchPathname('/site/crawls/c1/pages/p1')).toBe('/site');
    expect(projectSwitchPathname('/performance')).toBe('/performance');
  });

  it('puts every Agent path, known or not, in Agent mode', () => {
    expect(navigationMode('/agent/skills')).toBe('agent');
    expect(navigationMode('/agent/unknown')).toBe('agent');
    expect(navigationMode('/prompts')).toBe('dashboard');
  });
});
