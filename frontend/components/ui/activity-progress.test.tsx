import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { ActivityProgress } from './activity-progress';

describe('ActivityProgress', () => {
  it('reports factual completion and announces only the active work', () => {
    render(
      <ActivityProgress
        label="Preparing your project"
        steps={[
          { id: 'site', label: 'Opening your website', state: 'complete' },
          {
            id: 'market',
            label: 'Understanding what you offer',
            detail: '3 useful pages read',
            state: 'active',
          },
          { id: 'questions', label: 'Building balanced questions', state: 'pending' },
        ]}
      />,
    );

    const progress = screen.getByRole('progressbar', { name: '1 of 3 steps complete' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('Understanding what you offer. 3 useful pages read')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('renders an attention state without converting a machine token into copy', () => {
    render(
      <ActivityProgress
        label="Preparing your project"
        steps={[
          {
            id: 'site',
            label: 'We could not read the website',
            detail: 'Check the address and try again.',
            state: 'attention',
          },
        ]}
      />,
    );

    expect(screen.getByText('We could not read the website')).toBeInTheDocument();
    expect(screen.queryByText(/crawl_owned_site|discovery_unavailable/)).not.toBeInTheDocument();
  });
});
