import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';

import {
  EvidenceEmpty,
  EvidenceError,
  EvidenceFilteredEmpty,
  EvidenceSkeleton,
  TruncationNotice,
} from './evidence-states';

/**
 * `components/visibility` is the largest untested frontend directory, and Track
 * is the measured product outcome — so its data states are the ones a user
 * reads when the answer is "nothing", "not yet", or "we could not load it".
 *
 * The distinction these lock down is the one an untested surface loses: an
 * EMPTY result ("no executions yet — go run one") and a FILTERED-empty result
 * ("your filters excluded everything") are different facts, and collapsing them
 * tells a user their data does not exist when it does.
 */
describe('evidence loading and error states', () => {
  it('hides the skeleton from assistive technology', () => {
    const { container } = render(<EvidenceSkeleton title="Query Fanout" />);

    // A skeleton announced to a screen reader is noise, not content.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('offers a retry and promises the filters are untouched', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<EvidenceError title="Query Fanout" onRetry={onRetry} />);

    expect(screen.getByText(/Couldn't load this evidence/)).toBeVisible();
    expect(screen.getByText(/Your filters are unchanged/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Retry/ }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('evidence empty states', () => {
  it('sends a user with no executions to Runs', () => {
    render(
      <EvidenceEmpty
        title="Tracked answers"
        heading="No evidence yet"
        body="Run a visibility audit to collect evidence."
      />,
    );

    expect(screen.getByText('No evidence yet')).toBeVisible();
    // The fix for "no data" is to run something, so the state has to route
    // there rather than dead-ending.
    expect(screen.getByRole('link', { name: 'View Runs' })).toHaveAttribute('href', '/runs');
  });

  it('says filters are the cause when a filtered result is empty', () => {
    render(<EvidenceFilteredEmpty title="Query Fanout" body="Try widening the date range." />);

    expect(screen.getByText('No results match these filters')).toBeVisible();
    // Crucially NOT the "go run an audit" state: the data may well exist.
    expect(screen.queryByRole('link', { name: 'View Runs' })).not.toBeInTheDocument();
  });

  it('offers a clear-filters escape when the caller can clear them', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <EvidenceFilteredEmpty title="Query Fanout" body="Widen the range." onClear={onClear} />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('omits the clear-filters button when there is nothing to clear', () => {
    render(<EvidenceFilteredEmpty title="Query Fanout" body="Widen the range." />);

    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});

describe('TruncationNotice', () => {
  it('names the bounded window rather than implying a total', () => {
    render(<TruncationNotice limit={100} />);

    // The endpoint returns a newest-first window with no total, so the notice
    // must not suggest one.
    expect(screen.getByText(/Showing newest 100 executions/)).toBeVisible();
  });
});
