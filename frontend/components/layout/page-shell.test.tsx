import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { choiceFilter } from '@/components/ui/all-filters';
import { TabsRoot } from '@/components/ui/tabs';
import { DetailScreen, ListScreen, RouteLoadingScreen } from './page-shell';

describe('ListScreen', () => {
  it("names the route in the loading frame's header", () => {
    render(
      <MemoryRouter initialEntries={['/performance']}>
        <RouteLoadingScreen label="Loading performance…" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Performance' })).toBeInTheDocument();
  });

  it('draws the header, then the controls, then the content', () => {
    render(
      <MemoryRouter initialEntries={['/prompts']}>
        <ListScreen
          actions={<button type="button">Add prompts</button>}
          controls={{ actions: <button type="button">Export</button> }}
        >
          <p>Table</p>
        </ListScreen>
      </MemoryRouter>,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Prompts' });
    const filters = screen.getByRole('group', { name: 'Search and filters' });
    const content = screen.getByText('Table');
    expect(title.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      filters.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('puts a tabbed page’s filters after its tabs, and a row with an action in its own band', () => {
    const choice = (id: string) =>
      choiceFilter({
        id,
        label: id,
        value: 'all',
        defaultValue: 'all',
        groups: [{ options: [{ value: 'all', label: 'All' }] }],
        onChange: () => undefined,
      });
    const page = (actions?: ReactNode) => (
      <MemoryRouter initialEntries={['/visibility']}>
        <TabsRoot value="a" onValueChange={() => undefined}>
          <ListScreen
            tabs={{ items: [{ value: 'a', label: 'A' }], ariaLabel: 'Views' }}
            controls={{ filters: [choice('Period'), choice('Engine')], actions }}
          >
            <p>Table</p>
          </ListScreen>
        </TabsRoot>
      </MemoryRouter>
    );
    const band = (name: string | RegExp) =>
      screen.getByRole('button', { name }).closest('[data-page-band]');
    const { rerender } = render(page());
    expect(band(/^All filters/u)).toBe(screen.getByRole('tablist').closest('[data-page-band]'));
    rerender(page(<button type="button">Export</button>));
    expect(band(/^All filters/u)).toBe(band('Export'));
    expect(band('Export')).not.toBe(screen.getByRole('tablist').closest('[data-page-band]'));
  });
});

describe('DetailScreen', () => {
  it('puts a back button to the collection before the route title', () => {
    render(
      <MemoryRouter initialEntries={['/runs/abc']}>
        <DetailScreen title="Run details" back={{ href: '/runs', label: 'Back to runs' }}>
          <p>Body</p>
        </DetailScreen>
      </MemoryRouter>,
    );
    const back = screen.getByRole('link', { name: 'Back to runs' });
    const title = screen.getByRole('heading', { level: 1, name: 'Run details' });
    expect(back.getAttribute('href')).toMatch(/^\/runs/);
    // Reading order: the link precedes the H1 it belongs to.
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sets the supporting aside beside the main content, after it in reading order', () => {
    render(
      <MemoryRouter initialEntries={['/agent/actions/abc']}>
        <DetailScreen
          title="Action"
          back={{ href: '/agent/actions', label: 'Back to Actions' }}
          aside={<p>Evidence</p>}
        >
          <p>Plan</p>
        </DetailScreen>
      </MemoryRouter>,
    );
    const aside = screen.getByRole('complementary');
    expect(aside).toHaveTextContent('Evidence');
    expect(
      screen.getByText('Plan').compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
