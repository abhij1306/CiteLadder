import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';
import { MutationNotice } from './mutation-notice';

it('shows a refusal with its support reference and no retry', () => {
  renderWithProviders(
    <MutationNotice
      notice={{ message: 'That prompt already exists', retryable: false, code: 'conflict' }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText('That prompt already exists')).toBeInTheDocument();
  expect(screen.getByText('Support: code conflict')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('offers a retry for a transient failure', async () => {
  const onRetry = vi.fn();
  renderWithProviders(
    <MutationNotice notice={{ message: 'Please try again.', retryable: true }} onRetry={onRetry} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledOnce();
});
