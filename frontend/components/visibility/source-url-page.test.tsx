import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';

import { SourceUrlPageCard } from './source-url-page';

type Page = NonNullable<Parameters<typeof SourceUrlPageCard>[0]['page']>;

const ACTION = '44444444-4444-4444-8444-444444444444';

function page(overrides: Partial<Page> = {}): Page {
  return {
    state: 'inspected',
    reason: null,
    read_at: '2026-10-01T00:00:00Z',
    extracted_chars: 4200,
    page_format: 'listicle',
    page_format_method: 'heading_evidence',
    source_class: 'editorial_third_party',
    entities: [
      {
        entity_kind: 'brand',
        entity_name: 'Acme Corp',
        match_count: 0,
        presence: 'not_detected',
        match_method: 'none',
        passages: [],
      },
      {
        entity_kind: 'competitor',
        entity_name: 'Globex',
        match_count: 2,
        presence: 'present',
        match_method: 'exact_alias',
        passages: ['Globex leads the list for small teams.'],
      },
    ],
    standing: 'gap',
    action_id: ACTION,
    ...overrides,
  };
}

const URL = 'https://review.example/best-crm';

describe('what a cited page means for you', () => {
  it('tables you and the competitors listed where you are not, with their quote, and opens the Action', () => {
    render(<SourceUrlPageCard url={URL} page={page()} loading={false} />);

    const table = screen.getByRole('table');
    const [, you, globex] = within(table).getAllByRole('row');
    const [name, mentions, quote] = within(you!).getAllByRole('cell');
    expect(within(name!).getByText('Acme Corp')).toBeVisible();
    expect([mentions!.textContent, quote!.textContent]).toEqual(['0', '—Not applicable']);
    expect(within(globex!).getAllByRole('cell')[1]).toHaveTextContent('2');
    expect(within(globex!).getAllByRole('cell')[2]).toHaveTextContent(
      'Globex leads the list for small teams.',
    );
    expect(within(globex!).getByText('Globex', { selector: 'mark' })).toBeVisible();
    expect(screen.getByText(/Read .* ago|Read today/)).toBeVisible();
    expect(screen.queryByText(/characters/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the Action' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/actions/${ACTION}`),
    );
    const draft = screen.getByRole('link', { name: 'Draft the request' });
    const chat = new globalThis.URL(draft.getAttribute('href')!, 'https://app.test');
    expect({ path: chat.pathname, ...Object.fromEntries(chat.searchParams) }).toEqual({
      path: '/agent',
      action_id: ACTION,
    });
  });

  it('says a page was never read instead of reporting anyone absent', () => {
    render(
      <SourceUrlPageCard
        url={URL}
        page={page({
          read_at: null,
          state: 'blocked',
          entities: [],
          standing: 'blocked',
          action_id: null,
        })}
        loading={false}
      />,
    );

    expect(screen.getByText('Publisher blocks automated access')).toBeVisible();
    expect(screen.queryByText(/not found on the page/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Action|request/ })).toBeNull();
  });

  it("shows no card on a competitor's own page", () => {
    const { rerender } = render(
      <SourceUrlPageCard
        url={URL}
        page={page({ source_class: 'competitor_owned', standing: 'read' })}
        loading={false}
      />,
    );
    expect(screen.getByText('On this page')).toBeVisible();

    rerender(
      <SourceUrlPageCard
        url={URL}
        page={page({ source_class: 'competitor_owned', standing: 'competitor' })}
        loading={false}
      />,
    );
    expect(screen.queryByText('On this page')).toBeNull();
  });
});
