import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';

import { Notice } from './notice';

describe('Notice kind="read"', () => {
  it('retries the owning read and includes safe correlation information', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <Notice
        kind="read"
        error={new ApiError('Internal Server Error', 500, '', 'request-123')}
        title="Couldn't load the data"
        fallback="The request failed or timed out."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Error: Couldn't load the dataThe request failed or timed out.RetryCopy reference",
    );
    expect(screen.queryByText(/request-123/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Copy reference' }));
    expect(await navigator.clipboard.readText()).toBe('request-123');
  });

  it('drops a fallback that repeats the headline, even with a closing full stop', () => {
    render(
      <Notice
        kind="read"
        error={new ApiError('Internal Server Error', 500, '')}
        title="Couldn't load the latest Site health crawl"
        fallback="Couldn't load the latest Site health crawl."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Error: Couldn't load the latest Site health crawlRetry in a moment.Retry",
    );
  });

  it('does not offer blind retry for an access failure', () => {
    render(
      <Notice
        kind="read"
        error={new ApiError('Access denied', 403, '', undefined, { retryable: false })}
        title="Couldn't load the data"
        fallback="The request failed or timed out."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText(/check your workspace access/i)).toBeVisible();
  });

  it('does not show access guidance for a non-access failure', () => {
    render(
      <Notice
        kind="read"
        error={new ApiError('Invalid state', 422, '', undefined, { retryable: false })}
        title="Couldn't load the data"
        fallback="The request failed or timed out."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('Invalid state')).toBeVisible();
    expect(screen.queryByText(/check your workspace access/i)).not.toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('announces negative and warning notices as alerts and the rest as status, with the tone word', () => {
    const { rerender } = render(
      <Notice tone="negative" title="Crawl failed">
        The site returned 503.
      </Notice>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Error: Crawl failedThe site returned 503.',
    );

    rerender(<Notice tone="positive">Saved</Notice>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    rerender(
      <Notice tone="negative" standing>
        This cannot be undone.
      </Notice>,
    );
    expect(screen.getByText('This cannot be undone.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing without a title or body', () => {
    const { container } = render(<Notice tone="info" />);
    expect(container).toBeEmptyDOMElement();
    render(<Notice tone="info">Data refreshes nightly</Notice>);
    expect(screen.getByRole('status')).toHaveTextContent('Data refreshes nightly');
  });
});

describe('Notice kind="mutation"', () => {
  it('sends a plan-limit refusal to billing and leaves other refusals without that route', () => {
    const { unmount } = renderWithProviders(
      <Notice
        kind="mutation"
        notice={{
          message: 'Your plan includes 3 projects, and this workspace has 3',
          retryable: false,
          code: 'occupancy_limit_exceeded',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
    unmount();
    renderWithProviders(
      <Notice
        kind="mutation"
        notice={{ message: 'That prompt already exists', retryable: false, code: 'conflict' }}
      />,
    );
    expect(screen.getByText('That prompt already exists')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull();
  });

  it('offers the owner recovery action in place of Try again when one is given', () => {
    const { unmount } = renderWithProviders(
      <Notice
        kind="mutation"
        notice={{ message: 'Upload interrupted', retryable: true }}
        onRetry={() => undefined}
        recovery={<button type="button">Resume upload</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resume upload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    unmount();
    renderWithProviders(
      <Notice
        kind="mutation"
        notice={{ message: 'Upload interrupted', retryable: true }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
