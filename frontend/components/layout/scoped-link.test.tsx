import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ProjectLink } from './scoped-link';

vi.mock('@/lib/project/project-context', () => ({
  useOptionalProjectContext: () => null,
}));

describe('ProjectLink', () => {
  it('keeps an API supplied external destination readable without making it a link', () => {
    render(
      <MemoryRouter>
        <ProjectLink href="https://example.com">Evidence</ProjectLink>
      </MemoryRouter>,
    );
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps an ordinary app destination navigable', () => {
    render(
      <MemoryRouter>
        <ProjectLink href="/runs?tab=history">Runs</ProjectLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs?tab=history');
  });
});
