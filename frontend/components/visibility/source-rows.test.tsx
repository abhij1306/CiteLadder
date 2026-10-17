import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import type { SourceItem } from '@/lib/visibility/sources';
import { renderWithProviders } from '@/test/render';

import { UrlTable } from './source-rows';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';

function page(key: string, overrides: Partial<SourceItem>): SourceItem {
  return {
    key,
    retrieved: null,
    responses: 2,
    prompts: 1,
    annotations: 2,
    urls: 1,
    response_rate: 0.5,
    prompt_coverage: 1,
    retrieval_rate: null,
    citation_share: 0.5,
    citation_rate: 1,
    ownership: [],
    categories: [],
    taxonomy_versions: [],
    category_unavailable: false,
    response_delta: null,
    url_hash: null,
    inspection_state: null,
    opportunity_id: null,
    standing: null,
    action_id: null,
    title: null,
    page_format: null,
    page_format_method: null,
    last_cited_at: null,
    mentions: 0,
    brands: [],
    ...overrides,
  };
}

it('shows reads beside citations, and an engine without exposed reads as unavailable', () => {
  renderWithProviders(
    <UrlTable
      rows={[
        page('https://acme.example/pricing', { responses: 1, retrieved: 3 }),
        page('https://other.example/x', { responses: 2, retrieved: null }),
      ]}
      sort={null}
      onSort={vi.fn()}
      onOpenUrl={vi.fn()}
      retrieval={{ responses: 4, unavailable_engines: ['gemini'] }}
    />,
    { projectSelection: { activeProjectId: PROJECT } },
  );

  const [header, read, unexposed] = screen.getAllByRole('row');
  const columns = within(header!)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);
  const cell = (row: HTMLElement, label: string) =>
    within(row).getAllByRole('cell')[columns.indexOf(label)]!.textContent;
  expect([cell(read!, 'Cited in'), cell(read!, 'Retrieved')]).toEqual(['1', '3']);
  expect([cell(unexposed!, 'Cited in'), cell(unexposed!, 'Retrieved')]).toEqual([
    '2',
    'Unavailable',
  ]);
});

it('shows where you stand on each page and links a gap to its Action', () => {
  renderWithProviders(
    <UrlTable
      rows={[
        page('https://review.example/best', { standing: 'gap', action_id: ACTION }),
        page('https://news.example/story', { standing: 'not_read' }),
        page('https://blog.example/post', {}),
      ]}
      sort={null}
      onSort={vi.fn()}
      onOpenUrl={vi.fn()}
    />,
    { projectSelection: { activeProjectId: PROJECT } },
  );

  const [, gap, unread, untracked] = screen.getAllByRole('row');
  expect(within(gap!).getByText('Gap')).toBeVisible();
  expect(within(gap!).getByRole('link', { name: 'Action' })).toHaveAttribute(
    'href',
    `/agent/actions/${ACTION}?project=${PROJECT}`,
  );
  expect(within(unread!).getByText('Not read')).toBeVisible();
  expect(within(unread!).queryByRole('link', { name: 'Action' })).toBeNull();
  expect(within(untracked!).getByText('Not tracked')).toBeVisible();
});
