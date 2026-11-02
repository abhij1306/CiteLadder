import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { DetailScreen, ListScreen, RouteLoadingScreen } from './page-shell';

function measureAt(path: string, screenElement: React.ReactNode) {
  const { container, unmount } = render(
    <MemoryRouter initialEntries={[path]}>{screenElement}</MemoryRouter>,
  );
  const measure = container.querySelector('[data-page-measure]')?.getAttribute('data-page-measure');
  unmount();
  return measure;
}

describe('ListScreen measure', () => {
  it("takes the route's measure, so a route's loading frame and its page share one width", () => {
    expect(measureAt('/settings', <RouteLoadingScreen />)).toBe('workflow');
    expect(measureAt('/settings', <ListScreen>Settings</ListScreen>)).toBe('workflow');
    expect(measureAt('/agent/chats/abc', <RouteLoadingScreen />)).toBe('workflow');
    expect(measureAt('/agent/actions', <RouteLoadingScreen />)).toBe('analytical');
    expect(measureAt('/site', <ListScreen>Website</ListScreen>)).toBe('analytical');
  });

  it("names the route in the loading frame's identity band", () => {
    render(
      <MemoryRouter initialEntries={['/performance']}>
        <RouteLoadingScreen label="Loading performance…" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Performance' })).toBeInTheDocument();
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
