import { describe, expect, it, vi } from 'vite-plus/test';
import { fireEvent, render as raw, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { PagesTable } from './pages-table';
import {
  SITE_HEALTH_UUID as UUID,
  SITE_HEALTH_UUID_2 as CRAWL,
  makePageSummary as page,
} from '@/test/fixtures/site-health';

/** A DIFFERENT crawl than the table is rendering — the row must link back to
 * the crawl that actually analyzed the page, not the one in view. */
const SOURCE_CRAWL = '33333333-3333-4333-8333-333333333333';

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <MemoryRouter initialEntries={['/site']}>
      {children}
      <LocationDisplay />
    </MemoryRouter>
  );
}

function renderPages(ui: ReactElement) {
  return raw(ui, { wrapper: RouterTestWrapper });
}

describe('PagesTable', () => {
  it('exposes scores as cells in a native row and keeps keyboard navigation', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    const row = screen.getByRole('row', { name: /Homepage/ });
    expect(within(row).getByRole('cell', { name: '46' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^View / })).toBeInTheDocument();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent(`/site/crawls/${CRAWL}/pages/${UUID}`);
  });

  it('shows a non-null limited-evidence score without an internal confidence subtitle', () => {
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({
            web_fundamentals_state: 'limited_evidence',
            web_fundamentals_score: 46,
            aeo_measurement_state: 'excluded',
            aeo_readiness_score: null,
            aeo_measurement_coverage: null,
          }),
        ]}
      />,
    );
    expect(screen.getAllByText('Excluded')).toHaveLength(2);
    const row = screen.getByText('Homepage').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('46')).toBeInTheDocument();
    expect(within(row!).queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(within(row!).queryByText(/100% measured/i)).not.toBeInTheDocument();
  });

  it('renders the not-measured state for an unclassified page (null page_kind)', () => {
    renderPages(<PagesTable pages={[page({ page_kind: null })]} crawlId={CRAWL} />);
    expect(screen.queryByText('Article')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
  });

  it('uses the persisted unresolved-purpose reason for Other pages', () => {
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({
            page_kind: 'other',
            aeo_readiness_score: null,
            aeo_measurement_coverage: null,
            aeo_measurement_state: 'not_measured',
            aeo_measurement_reason: 'page_purpose_unresolved',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.queryByText(/purpose unresolved/i)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders the not-measured state for a blocked page — never a fabricated zero', () => {
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({
            site_url_id: '33333333-3333-4333-8333-333333333333',
            title: 'Admin Panel',
            analysis_status: 'blocked',
            issue_count: null,
            web_fundamentals_score: null,
            web_fundamentals_coverage: null,
            web_fundamentals_state: 'not_measured',
            aeo_readiness_score: null,
            aeo_measurement_coverage: null,
            aeo_measurement_state: 'not_measured',
            main_content_indexable: null,
            last_audited: null,
            page_kind: null,
          }),
        ]}
      />,
    );
    // No zeroes rendered for the missing scores.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    // Blocked status badge is shown.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    // Placeholder appears for the missing score/issue cells.
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
  });

  it('names where a failing URL is linked from, and only for a failing URL', () => {
    const referrers = [
      { site_url_id: UUID, url: 'https://example.com/' },
      { site_url_id: SOURCE_CRAWL, url: 'https://example.com/docs' },
    ];
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({
            display_url: 'https://example.com/gone',
            analysis_status: 'error',
            linked_from: referrers,
          }),
          page({
            site_url_id: SOURCE_CRAWL,
            display_url: 'https://example.com/fine',
            linked_from: referrers,
          }),
        ]}
      />,
    );
    expect(screen.getAllByText(/^Linked from/u).map((node) => node.textContent)).toEqual([
      'Linked from https://example.com/ and 1 more',
    ]);
  });

  it('navigates to the per-URL detail when the row is clicked', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    fireEvent.click(screen.getByText('Homepage'));
    expect(screen.getByTestId('location')).toHaveTextContent(`/site/crawls/${CRAWL}/pages/${UUID}`);
  });

  it('links an inherited discovered row to the crawl that owns its detail', () => {
    renderPages(
      <PagesTable
        pages={[page({ crawl_id: SOURCE_CRAWL, analysis_status: 'not_selected' })]}
        crawlId={CRAWL}
      />,
    );
    expect(screen.getByText('View').closest('a')).toHaveAttribute(
      'href',
      `/site/crawls/${SOURCE_CRAWL}/pages/${UUID}`,
    );
  });

  it('renders the persisted link and indexability metrics', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Indexable')).toBeInTheDocument();
  });

  it('shows an unmeasured link metric as Not measured, never a zero', () => {
    renderPages(
      <PagesTable
        pages={[page({ inbound_count: null, main_content_indexable: null })]}
        crawlId={CRAWL}
      />,
    );
    expect(screen.getAllByText('Not measured').length).toBeGreaterThanOrEqual(2);
  });

  it('asks the server to reorder, and marks the active column', async () => {
    const onSortChange = vi.fn();
    const { rerender } = renderPages(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="url" onSortChange={onSortChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Inbound/ }));
    expect(onSortChange).toHaveBeenCalledWith('inbound');

    rerender(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="inbound" onSortChange={onSortChange} />,
    );
    expect(screen.getByRole('columnheader', { name: /^Inbound/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('clicking the active sort returns to the default URL order', () => {
    const onSortChange = vi.fn();
    renderPages(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="inbound" onSortChange={onSortChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Inbound/ }));
    expect(onSortChange).toHaveBeenCalledWith('status');
  });

  it('offers server-backed URL and status sorting', () => {
    const onSortChange = vi.fn();
    renderPages(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="status" onSortChange={onSortChange} />,
    );
    expect(screen.getByRole('columnheader', { name: /^Status/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Page URL/ }));
    expect(onSortChange).toHaveBeenCalledWith('url');
  });

  it('renders plain link headers where the table cannot reorder', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    expect(screen.queryByRole('button', { name: /^Inbound/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Inbound' })).toBeInTheDocument();
  });
});
