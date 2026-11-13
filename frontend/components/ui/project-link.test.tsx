import { fireEvent, render, screen } from '@testing-library/react';
import { CircleHelp, History } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vite-plus/test';

import { IconButton } from './button';
import { ProjectLink } from './project-link';

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

describe('IconButton links', () => {
  it('routes an app path through the app router and keeps a web URL external', () => {
    render(
      <MemoryRouter initialEntries={['/visibility']}>
        <IconButton icon={History} label="Open run history" href="/runs?tab=history" />
        <IconButton icon={CircleHelp} label="About these metrics" href="https://docs.example.com" />
        <Routes>
          <Route path="/runs" element={<p>Run history</p>} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );
    const help = screen.getByRole('link', { name: 'About these metrics' });
    expect(help).toHaveAttribute('href', 'https://docs.example.com');
    expect(help).toHaveAttribute('rel', 'noreferrer');

    fireEvent.click(screen.getByRole('link', { name: 'Open run history' }));
    expect(screen.getByText('Run history')).toBeVisible();
  });
});
