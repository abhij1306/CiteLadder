import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { BulkActions } from './commerce-workspace';

describe('BulkActions', () => {
  it('enables bulk actions and reports the checked target count', () => {
    const onDiscover = vi.fn();
    const onClear = vi.fn();
    renderWithProviders(
      <BulkActions
        count={2}
        pending={false}
        error={null}
        onDiscover={onDiscover}
        onClear={onClear}
      />,
    );

    expect(screen.getByText('2 targets selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Find competitors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onDiscover).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('refuses a selection over the per-request limit and says why', () => {
    const onDiscover = vi.fn();
    renderWithProviders(
      <BulkActions
        count={11}
        pending={false}
        error={null}
        onDiscover={onDiscover}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Find competitors' })).toBeDisabled();
    expect(
      screen.getByText('Competitors can be found for up to 10 targets at a time.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
  });

  it('shows why a discovery request failed', () => {
    renderWithProviders(
      <BulkActions
        count={2}
        pending={false}
        error={new Error('The search provider is offline.')}
        onDiscover={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The search provider is offline.');
  });
});
