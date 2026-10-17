import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { Visibility, VisibilityEngine } from '@/lib/api/types';
import { EngineComparison } from './engine-comparison';

function engine(overrides: Partial<VisibilityEngine> = {}): VisibilityEngine {
  return {
    logical_engine: 'gemini',
    total_completed: 12,
    brand_mention_rate: 0.5,
    owned_citation_rate: 0.25,
    search_use_rate: 1,
    visibility_score: 62,
    ...overrides,
  };
}
function visibility(per_engine: VisibilityEngine[]): Visibility {
  return { per_engine, rankings: [], model_provenance: [] } as unknown as Visibility;
}
describe('model outcome comparison', () => {
  it('shows presence, citations and sample coverage without duplicating the composite', () => {
    render(<EngineComparison visibility={visibility([engine()])} filter="all" />);
    expect(screen.getByText('50%')).toBeVisible();
    expect(screen.getByText('25%')).toBeVisible();
    // The answer count is the reader's; the run's expected-vs-measured
    // bookkeeping that used to sit beside it is not.
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.queryByText(/expected/)).toBeNull();
    expect(screen.queryByText('62%')).toBeNull();
  });
  it('uses catalog order and narrows to the selected engine', () => {
    const { rerender } = render(
      <EngineComparison
        visibility={visibility([engine(), engine({ logical_engine: 'chatgpt' })])}
        filter="all"
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('ChatGPT API')).toBeVisible();
    rerender(
      <EngineComparison
        visibility={visibility([engine(), engine({ logical_engine: 'chatgpt' })])}
        filter="gemini"
      />,
    );
    expect(screen.queryByText('ChatGPT API')).toBeNull();
    expect(screen.getByText('Gemini API')).toBeVisible();
  });
  it('keeps no observations distinct from a measured absence', () => {
    render(
      <EngineComparison
        visibility={visibility([engine({ brand_mention_rate: 0, owned_citation_rate: null })])}
        filter="all"
      />,
    );
    expect(screen.getByText('0%')).toBeVisible();
    expect(screen.getByText('Not measured')).toBeVisible();
  });
  it('opens the selected engine evidence', () => {
    const onSelect = vi.fn();
    render(
      <EngineComparison visibility={visibility([engine()])} filter="all" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gemini API' }));
    expect(onSelect).toHaveBeenCalledWith('gemini');
  });
  it('discloses an empty model selection', () => {
    render(<EngineComparison visibility={visibility([])} filter="all" />);
    expect(screen.getByText('No model observations.')).toBeVisible();
  });
});
