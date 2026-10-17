import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { PageShell } from './page-shell';

describe('PageShell back slot', () => {
  it('puts the way back above the route title', () => {
    render(
      <MemoryRouter initialEntries={['/runs/abc']}>
        <PageShell title="Run details" back={{ href: '/runs', label: 'Back to runs' }}>
          <p>Body</p>
        </PageShell>
      </MemoryRouter>,
    );
    const back = screen.getByRole('link', { name: 'Back to runs' });
    const title = screen.getByRole('heading', { level: 1, name: 'Run details' });
    expect(back.getAttribute('href')).toMatch(/^\/runs/);
    // Reading order: the link precedes the H1 it belongs to.
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
