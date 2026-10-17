import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { CohortCompositionContext } from './cohort-composition-context';

describe('CohortCompositionContext', () => {
  it('names added and removed kinds with prior and current counts', () => {
    render(
      <CohortCompositionContext
        reason="cohort_composition_changed"
        composition={{
          added_page_kinds: ['product'],
          removed_page_kinds: ['article'],
          previous_page_count_by_kind: { homepage: 1, article: 3 },
          current_page_count_by_kind: { homepage: 1, product: 2 },
        }}
      />,
    );

    expect(screen.getByText('Scored cohort composition changed.')).toBeInTheDocument();
    expect(screen.getByText(/Added page kinds: Product/)).toBeInTheDocument();
    expect(screen.getByText(/Removed page kinds: Article/)).toBeInTheDocument();
    expect(screen.getByText('Article 3 · Homepage 1')).toBeInTheDocument();
    expect(screen.getByText('Homepage 1 · Product 2')).toBeInTheDocument();
    expect(screen.getByText(/not split into quality versus cohort effects/)).toBeInTheDocument();
  });

  it('renders nothing for a comparable unchanged cohort', () => {
    const { container } = render(
      <CohortCompositionContext
        reason="comparable_snapshot"
        composition={{
          added_page_kinds: [],
          removed_page_kinds: [],
          previous_page_count_by_kind: { homepage: 1 },
          current_page_count_by_kind: { homepage: 1 },
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
