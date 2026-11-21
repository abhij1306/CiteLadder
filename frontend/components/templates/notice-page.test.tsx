import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { NoticeScreen } from './notice-page';

describe('NoticeScreen', () => {
  it('announces a loading wait as a status named by its heading', async () => {
    render(<NoticeScreen tone="loading" heading="Loading your workspace…" />);

    expect(await screen.findByRole('status', { name: 'Loading your workspace…' })).toBeVisible();
  });
});
