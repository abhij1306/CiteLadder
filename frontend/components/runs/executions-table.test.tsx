import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Execution, ExecutionStatus } from '@/lib/api/types';

import { ExecutionsTable } from './executions-table';

/**
 * One row per execution of the run. Two rules carry weight here.
 *
 * Evidence is offered ONLY for a succeeded execution: a failed or in-flight one
 * has no persisted answer to show, so the affordance must not exist rather than
 * open an empty drawer.
 *
 * A null latency is "never reported", not "instant". Rendering it as `0 ms`
 * would put a fabricated measurement in a column of real ones.
 */
function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: `11111111-1111-4111-8111-${String(1).padStart(12, '0')}`,
    audit_id: '22222222-2222-4222-8222-222222222222',
    prompt_index: 0,
    repetition: 0,
    randomized_position: 0,
    logical_engine: 'gemini',
    transport_provider: 'google',
    transport_model: 'gemini-2.5-pro',
    retrieval_enabled: true,
    status: 'succeeded',
    attempt_count: 1,
    max_attempts: 3,
    prompt_text: 'Best trail running shoes',
    answer_text: 'An answer',
    search_used: true,
    error_code: '',
    error_detail: '',
    latency_ms: 1200,
    created_at: '2026-08-01T00:00:00Z',
    completed_at: '2026-08-01T00:00:02Z',
    ...overrides,
  } as Execution;
}

describe('ExecutionsTable', () => {
  it('shows the frozen prompt text without a repetition label', () => {
    render(
      <ExecutionsTable
        executions={[execution({ prompt_text: 'Best trail shoes', repetition: 2 })]}
        onSelectEvidence={vi.fn()}
      />,
    );

    expect(screen.getByText('Best trail shoes')).toBeVisible();
    expect(screen.queryByText(/rep 2/)).not.toBeInTheDocument();
  });

  it('falls back to the prompt ordinal when the snapshot text is empty', () => {
    // A pruned or empty snapshot still has to identify WHICH prompt this was,
    // or the row is unreadable.
    render(
      <ExecutionsTable
        executions={[execution({ prompt_text: '', prompt_index: 4 })]}
        onSelectEvidence={vi.fn()}
      />,
    );

    expect(screen.getByText('Prompt #5')).toBeVisible();
  });

  it('names the engine and the transport that served it', () => {
    render(
      <ExecutionsTable
        executions={[execution({ logical_engine: 'gemini', transport_provider: 'google' })]}
        onSelectEvidence={vi.fn()}
      />,
    );

    expect(screen.getByText('Gemini API')).toBeVisible();
    expect(screen.getByText('Google')).toBeVisible();
  });

  it('renders an unreported latency as a placeholder, not as zero', () => {
    render(
      <ExecutionsTable
        executions={[execution({ latency_ms: null, status: 'failed' })]}
        onSelectEvidence={vi.fn()}
      />,
    );

    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).queryByText(/ms$/)).not.toBeInTheDocument();
  });

  it('renders a genuinely zero latency as a measurement', () => {
    render(
      <ExecutionsTable executions={[execution({ latency_ms: 0 })]} onSelectEvidence={vi.fn()} />,
    );

    expect(screen.getByText(/^0\s?ms$/)).toBeVisible();
  });

  it('gives a failed execution a plain reason that never shows the raw error code', () => {
    render(
      <ExecutionsTable
        executions={[execution({ status: 'failed', error_code: 'some_new_provider_code' })]}
        onSelectEvidence={vi.fn()}
      />,
    );

    const row = screen.getAllByRole('row')[1]!;
    expect(row).not.toHaveTextContent('some_new_provider_code');
    expect(row.textContent).toMatch(/try/i);
  });

  it('shows no failure reason for an execution that did not fail', () => {
    render(<ExecutionsTable executions={[execution()]} onSelectEvidence={vi.fn()} />);

    expect(screen.getAllByRole('row')[1]!.textContent).not.toMatch(/try|reconnect|Settings/i);
  });

  it('names the engine an execution is waiting on', () => {
    render(
      <ExecutionsTable
        executions={[
          execution({ status: 'awaiting_provider_result', logical_engine: 'chatgpt_search' }),
        ]}
        onSelectEvidence={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('row')[1]!.textContent).toMatch(/waiting for .*chatgpt/i);
  });

  it('offers evidence for a succeeded execution', async () => {
    const user = userEvent.setup();
    const onSelectEvidence = vi.fn();
    const row = execution({ status: 'succeeded' });
    render(<ExecutionsTable executions={[row]} onSelectEvidence={onSelectEvidence} />);

    await user.click(screen.getByRole('button', { name: 'Evidence' }));

    // The drawer opens without leaving the run, and receives the exact row.
    expect(onSelectEvidence).toHaveBeenCalledTimes(1);
    expect(onSelectEvidence).toHaveBeenCalledWith(row);
  });

  it.each<ExecutionStatus>(['queued', 'running', 'failed', 'cancelled'])(
    'offers no evidence affordance for a %s execution',
    (status) => {
      // There is no persisted answer to show; an enabled control would open an
      // empty drawer.
      render(<ExecutionsTable executions={[execution({ status })]} onSelectEvidence={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Evidence' })).not.toBeInTheDocument();
    },
  );

  it('renders one row per execution', () => {
    render(
      <ExecutionsTable
        executions={[
          execution({ id: 'a1111111-1111-4111-8111-111111111111', repetition: 0 }),
          execution({ id: 'b1111111-1111-4111-8111-111111111111', repetition: 1 }),
          execution({ id: 'c1111111-1111-4111-8111-111111111111', repetition: 2 }),
        ]}
        onSelectEvidence={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('row')).toHaveLength(4); // header + three
  });

  it('renders only a header when the run has no executions yet', () => {
    render(<ExecutionsTable executions={[]} onSelectEvidence={vi.fn()} />);

    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});
