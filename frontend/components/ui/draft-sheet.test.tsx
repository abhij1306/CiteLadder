import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { DraftSheet } from './draft-sheet';

describe('DraftSheet', () => {
  it('sets its dashed edge solid when accepted and drops it when declined, keeping its actions', () => {
    const sheet = (state: 'draft' | 'accepted' | 'declined') => (
      <DraftSheet
        title="Mark /pricing implemented?"
        state={state}
        actions={<button>Open Action</button>}
      />
    );
    const { rerender } = render(sheet('draft'));
    const region = () => screen.getByRole('region', { name: 'Mark /pricing implemented?' });
    expect(region()).toHaveAttribute('data-draft', 'true');
    expect(region()).toHaveTextContent('Draft');

    rerender(sheet('accepted'));
    expect(region()).toHaveAttribute('data-draft', 'false');
    expect(region()).toHaveTextContent('Accepted');
    expect(screen.getByRole('button', { name: 'Open Action' })).toBeVisible();

    rerender(sheet('declined'));
    expect(region()).not.toHaveAttribute('data-draft');
    expect(region()).toHaveTextContent('Dismissed');
  });
});
