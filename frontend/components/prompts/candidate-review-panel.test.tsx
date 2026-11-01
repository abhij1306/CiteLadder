import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { CandidateReviewPanel } from './candidate-review';

const review: ComponentProps<typeof CandidateReviewPanel>['review'] = {
  candidates: [],
  refresh: vi.fn(async () => {}),
  accept: vi.fn(),
  reject: vi.fn(),
  isReviewing: false,
  isLoading: false,
  loadError: undefined,
  error: undefined,
  notice: null,
  clearNotice: vi.fn(),
};

it('says it is loading, then explains an empty or expired batch', () => {
  const view = (loading: boolean) => (
    <CandidateReviewPanel review={{ ...review, isLoading: loading }} topics={[]} />
  );
  const { rerender } = render(view(true));
  expect(screen.getByRole('status')).toHaveTextContent('Loading suggestions…');
  rerender(view(false));
  expect(screen.getByText(/expired or already been reviewed/i)).toBeVisible();
});

it('offers retry rather than showing an empty batch when the read fails', async () => {
  render(<CandidateReviewPanel review={{ ...review, loadError: 'Connection lost' }} topics={[]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(review.refresh).toHaveBeenCalledOnce();
});
