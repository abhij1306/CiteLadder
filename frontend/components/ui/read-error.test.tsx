import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';

import { ReadError } from './read-error';

describe('ReadError', () => {
  it('retries the owning read and includes safe correlation information', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ReadError
        error={new ApiError('Temporarily unavailable', 503, '', 'request-123')}
        fallback="Could not load data."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Reference: request-123')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not offer blind retry for an access failure', () => {
    render(
      <ReadError
        error={new ApiError('Access denied', 403, '', undefined, { retryable: false })}
        fallback="Could not load data."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText(/check your workspace access/i)).toBeVisible();
  });

  it('does not show access guidance for a non-access failure', () => {
    render(
      <ReadError
        error={new ApiError('Invalid state', 422, '', undefined, { retryable: false })}
        fallback="Could not load data."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/check your workspace access/i)).not.toBeInTheDocument();
  });
});
