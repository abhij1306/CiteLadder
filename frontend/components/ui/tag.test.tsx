import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { Tag } from './tag';

it('removes a tag from its named remove button', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(
    <Tag kind="removable" onRemove={onRemove}>
      ChatGPT
    </Tag>,
  );
  await user.click(screen.getByRole('button', { name: 'Remove ChatGPT' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

it('carries a long label in full in its tooltip', () => {
  const long =
    'AI Visibility tracking (brand mentions, position, sentiment and competitors across AI answers)';
  render(<Tag>{long}</Tag>);
  expect(screen.getByTitle(long)).toHaveTextContent(long);
});
