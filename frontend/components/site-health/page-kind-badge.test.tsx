import { describe, expect, it } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';

import { PageKindBadge } from './page-kind-badge';

describe('PageKindBadge', () => {
  it('renders the humanized page-kind label as a badge', () => {
    render(<PageKindBadge pageKind="about_contact" />);
    expect(screen.getByText('About / Contact')).toBeInTheDocument();
  });

  it.each([null, undefined])('renders %s as not measured, never a guessed type', (pageKind) => {
    render(<PageKindBadge pageKind={pageKind} />);
    expect(screen.getByText('Not measured')).toBeInTheDocument();
  });
});
