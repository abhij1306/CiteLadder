import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { FirstFrame } from './first-frame';

function frameAt(path: string) {
  const { container, unmount } = renderWithProviders(<FirstFrame />, { initialEntries: [path] });
  const frame = {
    path,
    shell: container.querySelector('[data-app-surface]') !== null,
    sidebarRows: container.querySelectorAll('nav li').length > 0,
  };
  unmount();
  return frame;
}

describe('FirstFrame', () => {
  it('draws the shell on a shell route and only the plain ground on a flow route', () => {
    const paths = ['/projects', '/prompts', '/login', '/register', '/workspaces', '/onboarding'];
    expect(paths.map(frameAt)).toEqual([
      { path: '/projects', shell: true, sidebarRows: true },
      { path: '/prompts', shell: true, sidebarRows: true },
      { path: '/login', shell: false, sidebarRows: false },
      { path: '/register', shell: false, sidebarRows: false },
      { path: '/workspaces', shell: false, sidebarRows: false },
      { path: '/onboarding', shell: false, sidebarRows: false },
    ]);
  });
});
