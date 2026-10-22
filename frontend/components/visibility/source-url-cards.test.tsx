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

  it('shows neither rows nor "no engine" after a failed read', () => {
    render(<EnginesCard engines={engines} loading={false} errored />);
    expect(screen.queryByRole('cell', { name: '7' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No engine used this page/)).not.toBeInTheDocument();
  });

  it('says no engine used the page only for a returned, empty list', () => {
    const { rerender } = render(<EnginesCard engines={[]} loading={false} />);
    expect(screen.getByText('No engine used this page in this selection.')).toBeInTheDocument();
    rerender(<EnginesCard engines={undefined} loading={false} />);
    expect(screen.queryByText(/No engine used this page/)).not.toBeInTheDocument();
  });
});
