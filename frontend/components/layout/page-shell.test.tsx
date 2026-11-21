import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { ReportPage } from '@/components/templates/report-page';
import { WorkbenchPage } from '@/components/templates/workbench-page';
import { choiceFilter } from '@/components/ui/all-filters';
import { FilterBar } from '@/components/ui/filter-bar';
import { TabRow, TabsRoot } from '@/components/ui/tabs';
import { CONTEXT_TABS } from '@/lib/agent/context-tabs';
import { TRAFFIC_TABS } from '@/lib/ai-traffic/tabs';
import { PERCEPTION_TABS } from '@/lib/perception/tabs';
import { SEARCH_INTELLIGENCE_TABS } from '@/lib/search-intelligence/tabs';
import { SETTINGS_TABS } from '@/lib/settings/tabs';
import { SITE_HEALTH_TABS } from '@/lib/site-health/tabs';
import { VISIBILITY_TABS } from '@/lib/visibility/tabs';
import { RouteLoadingScreen } from './page-shell';

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RouteLoadingScreen />
    </MemoryRouter>,
  );
}

describe('RouteLoadingScreen', () => {
  it('places the Overview’s default widgets as the grid does, each with its body’s shape', () => {
    const { container } = renderAt('/projects');
    const widgets = [...container.querySelectorAll<HTMLElement>('[data-loading-widget]')];
    expect(widgets.map((widget) => widget.dataset.loadingWidget)).toEqual([
      'project_state',
      'movement',
      'next_action',
      'missing_prompts',
      'ranked_actions',
      'company_facts',
    ]);
    expect(widgets.map((widget) => widget.parentElement?.hasAttribute('data-app-grid'))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(widgets[0]?.querySelectorAll('[data-figure-cell]')).toHaveLength(4);
  });

  it('draws a chat as its thread over the docked composer, never as cards', () => {
    const { container } = renderAt('/agent/chats/1');
    expect(screen.getByRole('heading', { level: 1, name: 'Chat' })).toBeInTheDocument();
    expect(container.querySelector('[data-thread] [data-skeleton="thread"]')).not.toBeNull();
    expect(container.querySelector('.shadow-pop')).not.toBeNull();
    expect(container.querySelector('[data-loading-shape]')).toBeNull();
  });

  it('draws Issues as its summary, then the table under its one control row', () => {
    const { container } = renderAt('/issues');
    expect(container.querySelector('[data-page-band="filters"]')).toBeNull();
    const order = [
      container.querySelector('[data-skeleton="summary"]'),
      container.querySelector('[data-filter-bar]'),
      container.querySelector('[data-loading-shape="table"]'),
    ];
    expect(order).not.toContain(null);
    order.slice(1).forEach((node, index) => {
      expect(order[index]!.compareDocumentPosition(node!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it.each([
    {
      path: '/visibility',
      title: 'Sources',
      tabs: labels(VISIBILITY_TABS),
      selected: 'Domains',
      filters: true,
      shapes: ['table', 'chart'],
    },
    {
      path: '/site/crawls?tab=changes',
      title: 'Site health',
      tabs: labels(SITE_HEALTH_TABS),
      selected: 'Changes',
      filters: false,
      shapes: ['figures', 'table'],
    },
    {
      path: '/search-intelligence?tab=backlinks',
      title: 'Keyword research',
      tabs: labels(SEARCH_INTELLIGENCE_TABS),
      selected: 'Backlinks',
      filters: true,
      shapes: ['table'],
    },
    {
      path: '/ai-traffic?tab=pages',
      title: 'AI traffic',
      tabs: labels(TRAFFIC_TABS),
      selected: 'Pages',
      filters: true,
      shapes: ['figures', 'chart'],
    },
    {
      path: '/perception',
      title: 'Perception',
      tabs: labels(PERCEPTION_TABS.filter((item) => item.value !== 'fact-checking')),
      selected: 'Brand',
      filters: true,
      shapes: ['figures', 'chart'],
    },
    {
      path: '/actions',
      title: 'Actions',
      tabs: [],
      filters: true,
      shapes: ['intro', 'figures', 'table'],
    },
    {
      path: '/agent/context?tab=instructions',
      title: 'Context',
      tabs: labels(CONTEXT_TABS),
      selected: 'Instructions',
      filters: false,
      shapes: ['facts'],
    },
    {
      path: '/settings?tab=workspace',
      title: 'Settings',
      tabs: labels(SETTINGS_TABS),
      selected: 'Workspace',
      filters: false,
      shapes: ['facts'],
    },
    {
      path: '/settings?tab=unknown',
      title: 'Settings',
      tabs: labels(SETTINGS_TABS),
      selected: 'Account',
      filters: false,
      shapes: ['facts'],
    },
    {
      path: '/runs?status=failed',
      title: 'Runs',
      tabs: ['All', 'Completed', 'Running', 'Failed'],
      selected: 'Failed',
      filters: false,
      shapes: ['table'],
    },
    {
      path: '/prompts/p1',
      title: 'Prompt',
      tabs: [],
      filters: true,
      shapes: ['figures', 'chart'],
    },
    {
      path: '/products/p1',
      title: 'Product',
      tabs: [],
      filters: false,
      shapes: ['facts', 'figures'],
    },
    { path: '/pricing', title: 'Pricing', tabs: [], filters: false, shapes: ['facts'] },
  ])('draws $path in its loaded frame', ({ path, title, tabs, selected, filters, shapes }) => {
    const { container } = renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    const held = container.querySelector('[data-held-tabs]');
    expect([...(held?.children ?? [])].map((tab) => tab.textContent)).toEqual(tabs);
    expect(held?.querySelector('[data-selected]')?.textContent).toBe(selected);
    if (held) expect(held).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(container.querySelector('[data-page-band="filters"]') !== null).toBe(filters);
    const drawn = [...container.querySelectorAll<HTMLElement>('[data-loading-shape]')];
    expect(drawn.map((node) => node.dataset.loadingShape)).toEqual(shapes);
  });
});

describe('PageFrame', () => {
  it('narrows a reading route’s page and a settings route’s further, unless a workbench fills it', () => {
    const widthAt = (path: string, page: ReactNode) => {
      const { container, unmount } = render(
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>,
      );
      const frame = container.querySelector('[data-masthead]')?.closest('[data-page-width]');
      const width = frame?.getAttribute('data-page-width');
      unmount();
      return width;
    };
    const report = <ReportPage>body</ReportPage>;
    expect([
      widthAt('/billing', report),
      widthAt('/actions/a1', report),
      widthAt('/site', report),
      widthAt('/agent/chats/c1', <WorkbenchPage>body</WorkbenchPage>),
      widthAt('/issues', <RouteLoadingScreen />),
    ]).toEqual(['compact', 'narrow', 'full', 'full', 'narrow']);
  });

  it('stacks the masthead, the page tabs band, the filter bar band, then the content', () => {
    const choice = (id: string) =>
      choiceFilter({
        id,
        label: id,
        value: 'all',
        defaultValue: 'all',
        groups: [{ options: [{ value: 'all', label: 'All' }] }],
        onChange: () => undefined,
      });
    render(
      <MemoryRouter initialEntries={['/visibility']}>
        <TabsRoot value="a" onValueChange={() => undefined}>
          <ReportPage
            tabs={<TabRow items={[{ value: 'a', label: 'A' }]} ariaLabel="Views" />}
            filters={<FilterBar filters={[choice('Period'), choice('Engine')]} />}
          >
            <p>Table</p>
          </ReportPage>
        </TabsRoot>
      </MemoryRouter>,
    );
    const order = [
      screen.getByRole('heading', { level: 1, name: 'Sources' }),
      screen.getByRole('tablist', { name: 'Views' }).closest('[data-page-band]'),
      screen.getByRole('button', { name: 'Filters' }).closest('[data-page-band]'),
      screen.getByText('Table'),
    ];
    expect(order.map((node) => node?.getAttribute('data-page-band') ?? node?.tagName)).toEqual([
      'H1',
      'tabs',
      'filters',
      'P',
    ]);
    order.slice(1).forEach((node, index) => {
      expect(order[index]!.compareDocumentPosition(node!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });
});
