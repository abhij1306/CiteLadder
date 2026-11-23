import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';

import { EnginesCard } from './source-url-cards';

const engines = [{ logical_engine: 'chatgpt', transport_model: null, retrievals: 7 }];

describe('EnginesCard', () => {
  it('lists each engine that used the page once, without its models', () => {
    render(
      <EnginesCard
        engines={[
          { logical_engine: 'claude', transport_model: 'claude-sonnet-5-5', retrievals: 2 },
          { logical_engine: 'chatgpt', transport_model: 'gpt-6.1', retrievals: 3 },
          { logical_engine: 'chatgpt', transport_model: 'gpt-6.1-terra', retrievals: 4 },
        ]}
        loading={false}
      />,
    );
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(['ChatGPT API7', 'Claude API2']);
  });

  it('shows neither rows nor "no engine" after a failed read', () => {
    render(<EnginesCard engines={engines} loading={false} errored />);
    expect(screen.queryByRole('cell', { name: '7' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('says no engine used the page only for a returned, empty list', () => {
    const { rerender } = render(<EnginesCard engines={[]} loading={false} />);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    rerender(<EnginesCard engines={undefined} loading={false} />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});
