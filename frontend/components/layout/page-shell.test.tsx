import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { DetailScreen } from './page-shell';

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
