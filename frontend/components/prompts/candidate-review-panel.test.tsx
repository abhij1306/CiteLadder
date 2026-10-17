import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { CandidateReviewPanel } from './candidate-review';
import { GeneratePromptsDialog } from './generate-prompts-dialog';

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

it('keeps review open while loading and explains an empty or expired batch', async () => {
  const view = (loading: boolean) => (
    <GeneratePromptsDialog
      open
      onOpenChange={vi.fn()}
      topics={[]}
      onGenerate={vi.fn()}
      review={<CandidateReviewPanel review={{ ...review, isLoading: loading }} topics={[]} />}
    />
  );
  const { rerender } = render(view(true));
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  rerender(view(false));
  expect(screen.getByText(/expired or already been reviewed/i)).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Generate more' }));
  expect(screen.getByRole('spinbutton')).toBeVisible();
});

it('offers retry rather than showing an empty batch when the read fails', async () => {
  render(<CandidateReviewPanel review={{ ...review, loadError: 'Connection lost' }} topics={[]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(review.refresh).toHaveBeenCalledOnce();
});
