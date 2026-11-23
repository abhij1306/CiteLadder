import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { RecordPage } from './record-page';

const masthead = () => document.querySelector<HTMLElement>('[data-masthead]')!;
const body = () => document.querySelector<HTMLElement>('[data-page-body]')!;

describe('RecordPage', () => {
  it('trails a record to its route collection in the masthead and names it in the h1 above the body', async () => {
    renderWithProviders(
      <RecordPage title="Nov 18 run">
        <p>Body</p>
      </RecordPage>,
      { initialEntries: ['/runs/run-1'] },
    );

    const trail = await within(masthead()).findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Runs' }).getAttribute('href')).toMatch(
      /^\/runs/,
    );
    expect(within(trail).getByText('Nov 18 run').closest('li')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Nov 18 run');
    expect(masthead()).not.toContainElement(heading);
    expect(heading.compareDocumentPosition(body()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByRole('link', { name: /back/i })).not.toBeInTheDocument();
  });

  it('heads a top-level page with its title and names it in the masthead after its section, with no trail', async () => {
    renderWithProviders(
      <RecordPage>
        <p>Body</p>
      </RecordPage>,
      { initialEntries: ['/runs'] },
    );

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Runs');
    expect(masthead()).not.toContainElement(heading);
    expect(masthead().textContent).toBe('TrackingRuns');
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });
});
