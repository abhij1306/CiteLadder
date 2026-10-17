import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { PromptCandidate } from '@/lib/api/types';

import { CandidateReview } from './candidate-review';

const candidate = (id: string, text: string): PromptCandidate => ({
  id,
  run_id: 'run',
  prompt_set_id: 'set',
  topic_id: null,
  text,
  intent: '',
  buyer_stage: '',
  prompt_intent: '',
  cohort: 'core',
  created_at: '',
  expires_at: '',
  quality_status: 'off',
  quality_flags: [],
  grounded: false,
});

const trailShoes = candidate('a', 'best trail shoes for wet weather');
const flatFeet = candidate('b', 'which running shoes suit flat feet');
const candidates = [trailShoes, flatFeet];

describe('CandidateReview', () => {
  it('associates distinct quality states with selectable suggestions', async () => {
    render(
      <CandidateReview
        candidates={[
          { ...trailShoes, quality_status: 'unavailable' },
          { ...flatFeet, quality_status: 'judged' },
          candidate('c', 'Which shoes suit walking to work?'),
          { ...candidate('d', 'Which shoes suit a first marathon?'), quality_status: 'not_judged' },
        ]}
        topics={[]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const choices = screen.getAllByRole('checkbox', { name: /Select “/ });
    const descriptions = choices.map((choice) => {
      expect(choice).toHaveAccessibleDescription();
      expect(choice).toBeEnabled();
      return document.getElementById(choice.getAttribute('aria-describedby')!)?.textContent;
    });
    // Disabled judging and skipped/failed checks must not become the same state.
    expect(new Set(descriptions).size).toBe(4);
    await userEvent.setup().click(choices[2]!);
    expect(screen.getByRole('button', { name: /accept selected/i })).toBeEnabled();
  });
  it('accepts only the selected suggestions and rejects after select-all', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <CandidateReview
        candidates={candidates}
        topics={[]}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );

    const accept = screen.getByRole('button', { name: /accept selected/i });
    expect(accept).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /which running shoes/i }));
    expect(screen.getByRole('checkbox', { name: /select all/i })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    await user.click(accept);
    expect(onAccept).toHaveBeenCalledWith(['b']);

    // The selection survives the request (a failure can be retried).
    await user.click(screen.getByRole('button', { name: /reject selected/i }));
    expect(onReject).toHaveBeenCalledWith(['b']);
  });

  it('shows quality flags as advisory labels without hiding the suggestion', () => {
    render(
      <CandidateReview
        candidates={[{ ...trailShoes, quality_status: 'judged', quality_flags: ['natural'] }]}
        topics={[]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText('best trail shoes for wet weather')).toBeInTheDocument();
    expect(screen.getByText('May read unnaturally')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /best trail shoes/i })).toBeEnabled();
  });

  it('tags only suggestions whose phrasing your search data informed', () => {
    render(
      <TooltipProvider>
        <CandidateReview
          candidates={[{ ...trailShoes, grounded: true }, flatFeet]}
          topics={[]}
          onAccept={vi.fn()}
          onReject={vi.fn()}
        />
      </TooltipProvider>,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent?.includes('Informed by your search data'))).toEqual([
      true,
      false,
    ]);
    expect(screen.getAllByRole('button', { name: 'About search data' })).toHaveLength(1);
  });
});
