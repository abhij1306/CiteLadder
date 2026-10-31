import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';

import { EnginesCard } from './source-url-cards';

const engines = [{ logical_engine: 'chatgpt', transport_model: null, retrievals: 7 }];

describe('EnginesCard', () => {
  it('lists the engines that used the page', () => {
    render(<EnginesCard engines={engines} loading={false} />);
    expect(screen.getByRole('cell', { name: '7' })).toBeInTheDocument();
  });

  // The card title is one h3; a "no engine" empty state adds a second.
  it('shows neither rows nor "no engine" after a failed read', () => {
    render(<EnginesCard engines={engines} loading={false} errored />);
    expect(screen.queryByRole('cell', { name: '7' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });

  it('says no engine used the page only for a returned, empty list', () => {
    const { rerender } = render(<EnginesCard engines={[]} loading={false} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    rerender(<EnginesCard engines={undefined} loading={false} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });
});
