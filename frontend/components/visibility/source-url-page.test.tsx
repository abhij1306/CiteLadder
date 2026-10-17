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
  it('names the competitors listed where you are not, with their lines, and opens the Action', () => {
    render(<SourceUrlPageCard url={URL} page={page()} loading={false} />);

    expect(screen.getByText('Competitors are listed on this page and you are not.')).toBeVisible();
    const listed = screen.getByText('Listed here').parentElement!;
    expect(within(listed).getByText('Globex')).toBeVisible();
    expect(screen.getByText(/Globex leads the list for small teams\./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open the Action' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/agent/actions/${ACTION}`),
    );
    expect(
      screen.getByText('Searched 4,200 characters of readable text; no form of the name matched.'),
    ).toBeVisible();
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

    expect(
      screen.getByText('The publisher blocks automated access, so this page has not been read.'),
    ).toBeVisible();
    expect(screen.queryByText(/not found on the page/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Action|request/ })).toBeNull();
  });

  it("offers nothing to do on a competitor's own page", () => {
    render(
      <SourceUrlPageCard
        url={URL}
        page={page({ source_class: 'competitor_owned', standing: 'competitor' })}
        loading={false}
      />,
    );

    expect(
      screen.getByText("This is a competitor's own page, so it cannot list you."),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open the Action' })).toBeNull();
  });
});
