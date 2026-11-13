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
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent(`/site/crawls/${CRAWL}/pages/${UUID}`);
  });

  it('shows seven columns, the page title as the link to its detail', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      '#',
      'Page',
      'Type',
      'Issues',
      'Web Fundamentals',
      'AEO Readiness',
      'Last Audit',
    ]);
    const link = screen.getByRole('link', { name: /^View Homepage — / });
    expect(link).toHaveTextContent('Homepage');
    expect(link).toHaveAttribute('href', `/site/crawls/${CRAWL}/pages/${UUID}`);
  });

  it('shows the status badge beside the title only while analysis is not completed', () => {
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({ title: 'Fine page' }),
          page({ site_url_id: SOURCE_CRAWL, title: 'Queued page', analysis_status: 'pending' }),
        ]}
      />,
    );
    const done = screen.getByRole('row', { name: /Fine page/ });
    const queued = screen.getByRole('row', { name: /Queued page/ });
    expect(within(queued).getByText('Pending')).toBeInTheDocument();
    expect(within(done).queryByText('Completed')).not.toBeInTheDocument();
  });

  it('marks only a page fetched despite a robots.txt exclusion', () => {
    renderPages(
      <PagesTable
        crawlId={CRAWL}
        pages={[
          page({ title: 'Open page' }),
          page({ site_url_id: SOURCE_CRAWL, title: 'Private page', robots_excluded: true }),
        ]}
      />,
    );
    const open = screen.getByRole('row', { name: /Open page/ });
    const excluded = screen.getByRole('row', { name: /Private page/ });
    expect(within(excluded).getByText('Robots.txt excluded')).toBeInTheDocument();
    expect(within(open).queryByText('Robots.txt excluded')).not.toBeInTheDocument();
  });

  it('keeps a limited-evidence score from reading as fully measured', () => {
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
    const row = screen.getByText('Homepage').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByRole('cell', { name: 'Excluded' })).toBeInTheDocument();
    // A measured score is the number alone: no evidence caption under it.
    expect(within(row!).getByRole('cell', { name: '46' })).toBeInTheDocument();
    expect(within(row!).queryByText('Limited evidence')).not.toBeInTheDocument();
    expect(within(row!).queryByText(/confidence/i)).not.toBeInTheDocument();
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
            robots_excluded: false,
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
    expect(screen.getByRole('link', { name: /^View Homepage — / })).toHaveAttribute(
      'href',
      `/site/crawls/${SOURCE_CRAWL}/pages/${UUID}`,
    );
  });

  it('asks the server to order by URL from the Page header, and back to the default', () => {
    const onSortChange = vi.fn();
    const { rerender } = renderPages(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="status" onSortChange={onSortChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Page/ }));
    expect(onSortChange).toHaveBeenLastCalledWith('url');

    rerender(
      <PagesTable pages={[page()]} crawlId={CRAWL} sort="url" onSortChange={onSortChange} />,
    );
    expect(screen.getByRole('columnheader', { name: /^Page/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Page/ }));
    expect(onSortChange).toHaveBeenLastCalledWith('status');
  });

  it('renders a plain Page header where the table cannot reorder', () => {
    renderPages(<PagesTable pages={[page()]} crawlId={CRAWL} />);
    expect(screen.queryByRole('button', { name: /^Page/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Page' })).toBeInTheDocument();
  });
});
