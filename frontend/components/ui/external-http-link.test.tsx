import { render, screen } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Button } from './button';
import { ExternalHttpLink } from './external-http-link';

describe('ExternalHttpLink', () => {
  it('opens an absolute HTTP URL with isolated browser context', () => {
    render(<ExternalHttpLink href="https://example.com/page">Source page</ExternalHttpLink>);
    expect(screen.getByRole('link', { name: 'Source page' })).toHaveAttribute(
      'href',
      'https://example.com/page',
    );
    expect(screen.getByRole('link', { name: 'Source page' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('leaves unsafe API destinations readable without navigation', () => {
    const { rerender } = render(
      <ExternalHttpLink href="javascript:alert(1)">Source page</ExternalHttpLink>,
    );
    expect(screen.getByText('Source page')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<ExternalHttpLink href="https:\\example.com/path">Source page</ExternalHttpLink>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps slotted button attributes and events on a valid contact link', () => {
    const onClick = vi.fn((event: MouseEvent<HTMLButtonElement>) => event.preventDefault());
    render(
      <Button asChild variant="secondary" size="sm" onClick={onClick} aria-label="Contact sales">
        <ExternalHttpLink href="https://example.com/contact">Sales</ExternalHttpLink>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Contact sales' });
    link.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
