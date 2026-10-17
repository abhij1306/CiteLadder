import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ReviewStep } from './review-step';

vi.mock('@/lib/brand/logo-dev', () => ({
  logoDevUrl: (websiteUrl?: string | null) =>
    websiteUrl ? `https://logos.example/${websiteUrl}` : null,
}));

describe('ReviewStep competitor limit', () => {
  it('shows a competitor logo and website without its name', () => {
    const { container } = render(
      <ReviewStep
        domains={[]}
        competitors={[
          {
            id: 'competitor-1',
            name: 'Summit Gear',
            aliases: [],
            domains: ['summit-gear.example'],
            selected: true,
          },
        ]}
        maximumCompetitors={5}
        onToggleDomain={vi.fn()}
        onToggleCompetitor={vi.fn()}
        onEditCompetitor={vi.fn()}
        onRemoveCompetitor={vi.fn()}
        onAddCompetitor={vi.fn()}
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      'https://logos.example/summit-gear.example',
    );
    expect(screen.getByRole('button', { name: 'Summit Gear' })).toBeInTheDocument();
    expect(screen.getByText('summit-gear.example')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://summit-gear.example' })).toHaveAttribute(
      'href',
      'https://summit-gear.example',
    );
  });

  it('preserves an existing competitor URL scheme without duplication', () => {
    render(
      <ReviewStep
        domains={[]}
        competitors={[
          {
            id: 'competitor-1',
            name: 'Example competitor',
            aliases: [],
            domains: ['http://competitor.example'],
            selected: true,
          },
        ]}
        maximumCompetitors={5}
        onToggleDomain={vi.fn()}
        onToggleCompetitor={vi.fn()}
        onEditCompetitor={vi.fn()}
        onRemoveCompetitor={vi.fn()}
        onAddCompetitor={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: 'http://competitor.example' });
    expect(link).toHaveAttribute('href', 'http://competitor.example');
    expect(screen.queryByText('https://http://competitor.example')).not.toBeInTheDocument();
  });

  it('shows the backend limit and disables additions at five selected competitors', async () => {
    const add = vi.fn();
    render(
      <ReviewStep
        domains={[]}
        competitors={Array.from({ length: 5 }, (_, index) => ({
          id: `competitor-${index}`,
          name: `Competitor ${index + 1}`,
          aliases: [],
          domains: [],
          selected: true,
        }))}
        maximumCompetitors={5}
        onToggleDomain={vi.fn()}
        onToggleCompetitor={vi.fn()}
        onEditCompetitor={vi.fn()}
        onRemoveCompetitor={vi.fn()}
        onAddCompetitor={add}
      />,
    );

    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(add).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Competitor 1' })).toBeEnabled();
  });

  it('accepts a manual name and domain before the choice is submitted', async () => {
    const edit = vi.fn();
    render(
      <ReviewStep
        domains={[]}
        competitors={[{ id: 'manual', name: '', aliases: [], domains: [], selected: true }]}
        maximumCompetitors={5}
        onToggleDomain={vi.fn()}
        onToggleCompetitor={vi.fn()}
        onEditCompetitor={edit}
        onRemoveCompetitor={vi.fn()}
        onAddCompetitor={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Competitor name' }), 'Peer');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Website for New competitor' }),
      'peer.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(edit).toHaveBeenCalledWith(0, 'Peer', 'peer.com');
  });

  it('can cancel an unsaved fifth manual choice and free the selection slot', async () => {
    const remove = vi.fn();
    const selected = Array.from({ length: 4 }, (_, index) => ({
      id: `peer-${index}`,
      name: `Peer ${index}`,
      aliases: [],
      domains: [`peer-${index}.com`],
      selected: true,
    }));
    const props = {
      domains: [],
      maximumCompetitors: 5,
      onToggleDomain: vi.fn(),
      onToggleCompetitor: vi.fn(),
      onEditCompetitor: vi.fn(),
      onRemoveCompetitor: remove,
      onAddCompetitor: vi.fn(),
    };
    const { rerender } = render(
      <ReviewStep
        {...props}
        competitors={[
          ...selected,
          { id: 'manual', name: '', aliases: [], domains: [], selected: true },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).toHaveBeenCalledWith(4);
    rerender(<ReviewStep {...props} competitors={selected} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });
});
