import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { DASHBOARD_GROUPS, FOOT_NAV_ITEMS, pageSection } from '@/components/layout/nav-items';
import { sidebarNavRowClasses } from '@/components/ui/sidebar';
import * as manifest from '@/lib/navigation/app-routes';

import { BOOT_SIDEBAR_MARKER, bootSidebarHtml, bootTitleScript } from './boot-shell';

const script = bootTitleScript(manifest);
const indexHtml = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');
const bootStyle = /<style>([\s\S]*?)<\/style>/u.exec(indexHtml)?.[1] ?? '';
const bootRoot = (/<div id="root">([\s\S]*?)<\/div>\s*<!--/u.exec(indexHtml)?.[1] ?? '').replace(
  BOOT_SIDEBAR_MARKER,
  bootSidebarHtml(manifest),
);

function bootAt(path: string) {
  window.history.replaceState(null, '', path);
  document.head.innerHTML = `<style>${bootStyle}</style>`;
  document.title = 'CiteLadder';
  document.body.innerHTML = `<div id="root">${bootRoot}</div>`;
  new Function(script)();
  const shell = document.querySelector<HTMLElement>('.boot-shell')!;
  const shown = (selector: string) =>
    getComputedStyle(shell.querySelector(selector)!).display !== 'none';
  return {
    title: shell.querySelector('.boot-title')?.textContent ?? '',
    section: shell.querySelector('.boot-section')?.textContent ?? '',
    mode: shell.dataset.bootMode,
    width: shell.style.getPropertyValue('--boot-side-width'),
    frame: { sidebar: shown('.boot-side'), masthead: shown('.boot-main') },
  };
}

describe('boot-title.js', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it("names every path's section and title as the mounted page header does", () => {
    const paths = manifest.APP_ROUTES.flatMap(({ path }) => {
      const concrete = path.replaceAll(/:[^/]+/gu, 'x1');
      return [concrete, `${concrete}/deeper`];
    });
    for (const path of [...paths, '/', '/nowhere']) {
      const titled = manifest.hasPageTitle(path);
      const { title, section } = bootAt(path);
      expect({ path, title, section }).toEqual({
        path,
        title: titled ? manifest.resolveTitle(path) : '',
        section: titled ? pageSection(path, new URLSearchParams()).title : '',
      });
    }
  });

  it('names the document and the mode on a shell page', () => {
    expect(bootAt('/runs/1')).toMatchObject({ title: 'Run', mode: 'dashboard' });
    expect(document.title).toBe('Run · CiteLadder');
    expect(bootAt('/agent/chats/1')).toMatchObject({ title: 'Chat', mode: 'agent' });
  });

  it('draws the shell frame on a shell page and only the bare ground on a flow page', () => {
    const shell = { sidebar: true, masthead: true };
    const ground = { sidebar: false, masthead: false };
    const frames = [
      '/projects',
      '/runs/1',
      '/login',
      '/register',
      '/workspaces',
      '/onboarding',
    ].map((path) => ({ path, frame: bootAt(path).frame }));
    expect(frames).toEqual([
      { path: '/projects', frame: shell },
      { path: '/runs/1', frame: shell },
      { path: '/login', frame: ground },
      { path: '/register', frame: ground },
      { path: '/workspaces', frame: ground },
      { path: '/onboarding', frame: ground },
    ]);
    expect(document.title).toBe('CiteLadder');
  });

  it('applies the stored sidebar width within its bounds', () => {
    window.localStorage.setItem('citeladder:app:sidebar-width', '300');
    expect(bootAt('/projects').width).toBe('300px');
    window.localStorage.setItem('citeladder:app:sidebar-width', '9000');
    expect(bootAt('/projects').width).toBe('480px');
    window.localStorage.removeItem('citeladder:app:sidebar-width');
    expect(bootAt('/projects').width).toBe('');
  });
});

describe('the boot shell geometry', () => {
  const appTokens = /:root:not\(\[data-public-surface\]\) \{([\s\S]*?)\n\}/u.exec(
    readFileSync(join(import.meta.dirname, 'src/globals.css'), 'utf8'),
  )?.[1];
  const token = (name: string) =>
    Number(new RegExp(`${name}: (\\d+)px;`, 'u').exec(appTokens ?? '')?.[1]);
  const px = (element: Element, property: 'height') =>
    Number.parseFloat(getComputedStyle(element)[property]);

  it('draws the page header, the switch and the rows at the live tokens and weights', () => {
    bootAt('/projects');
    const at = (selector: string) => document.querySelector(selector)!;
    expect({
      masthead: px(at('.boot-mast'), 'height'),
      ident: px(at('.boot-ident'), 'height'),
      switch: px(at('.boot-mode'), 'height'),
      row: px(at('.boot-row'), 'height'),
      rowWeight: getComputedStyle(at('.boot-row')).fontWeight,
    }).toEqual({
      masthead: token('--masthead-height'),
      ident: token('--masthead-height'),
      switch: token('--control-md'),
      row: token('--nav-row-height'),
      rowWeight: sidebarNavRowClasses(false).includes('font-normal') ? '400' : '500',
    });
  });
});

describe('the boot sidebar', () => {
  it('lists the live sidebar rows in order, group labels before their rows', () => {
    document.body.innerHTML = bootSidebarHtml(manifest);
    const rows = [...document.querySelectorAll('.boot-group-title, .boot-row')].map(
      (node) => node.textContent,
    );
    expect(rows).toEqual([
      ...DASHBOARD_GROUPS.flatMap((group) => [
        ...(group.title ? [group.title] : []),
        ...group.items.map((item) => item.label),
      ]),
      ...FOOT_NAV_ITEMS.map((item) => item.label),
    ]);
    expect(rows).toContain('Brand');
  });
});
