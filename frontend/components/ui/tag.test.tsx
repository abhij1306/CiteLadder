import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vite-plus/test';

import { TagGroup } from './tag';

it('reveals overflow labels from the keyboard and keeps the disclosure focused', async () => {
  const user = userEvent.setup();
  render(<TagGroup labels={['Analytics', 'Research', 'Consulting', 'Training']} />);
  expect(screen.queryByText('Consulting')).not.toBeInTheDocument();
  await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByText('Consulting')).toBeVisible();
  expect(screen.getByText('Training')).toBeVisible();
  const collapse = screen.getByRole('button', { name: 'Show fewer tags' });
  expect(collapse).toHaveFocus();
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Enter}');
  expect(screen.queryByText('Consulting')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show 2 more tags' })).toHaveFocus();
});

it('does not offer a disclosure when all labels fit', () => {
  render(<TagGroup labels={['Analytics', 'Research']} />);
  expect(screen.getByText('Research')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
