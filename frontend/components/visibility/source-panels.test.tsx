import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { setUrlParams } from '@/lib/navigation/url-state';
import type { SourcesData } from '@/lib/visibility/sources';
import { SourcePaging } from './source-panels';

vi.mock('@/lib/navigation/url-state', () => ({ setUrlParams: vi.fn() }));

it('navigates using server cursors and disables navigation while loading', () => {
  const data: SourcesData = {
    total: 3,
    responses: 2,
    prompts: 1,
    total_citations: 4,
    category_totals: {},
    as_of: '2026-03-01T00:00:00Z',
    next_cursor: 'next',
    previous_cursor: 'previous',
    comparison_status: 'no_baseline',
    retrieval: { responses: 0, unavailable_engines: [] },
    items: [],
  };
  const props = {
    data,
    domain: null,
    dimension: 'domain' as const,
    offset: 1,
    pageSize: 1,
    busy: false,
    onPageSizeChange: vi.fn(),
  };
  const view = render(<SourcePaging {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(setUrlParams).toHaveBeenLastCalledWith({
    source_offset: '2',
    source_cursor: 'next',
    source_as_of: data.as_of,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(setUrlParams).toHaveBeenLastCalledWith({
    source_offset: null,
    source_cursor: 'previous',
    source_as_of: null,
  });
  view.rerender(<SourcePaging {...props} busy />);
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
});
