import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { Tag, TagGroup } from './tag';

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

it('removes a tag from its named remove button', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(<Tag onRemove={onRemove}>ChatGPT</Tag>);
  await user.click(screen.getByRole('button', { name: 'Remove ChatGPT' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

it('carries a long label in full in its tooltip', () => {
  // The cut itself is geometry; e2e/surface-layout.spec.ts holds the page to
  // the viewport with this label at 982px.
  const long =
    'AI Visibility tracking (brand mentions, position, sentiment and competitors across AI answers)';
  render(<TagGroup labels={[long, 'Citation Intelligence']} />);
  expect(screen.getByTitle(long)).toHaveTextContent(long);
  expect(screen.getByTitle('Citation Intelligence')).toHaveTextContent('Citation Intelligence');
});

it('does not offer a disclosure when all labels fit', () => {
  render(<TagGroup labels={['Analytics', 'Research']} />);
  expect(screen.getByText('Research')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
