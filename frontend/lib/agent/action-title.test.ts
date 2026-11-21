import { describe, expect, it } from 'vite-plus/test';

import { actionTitle, type TitledAction } from './action-title';

const page = (target_label: string, approach: string | null = 'improve_links'): TitledAction => ({
  target_kind: 'page',
  target_label,
  approach,
});

describe('actionTitle', () => {
  it.each<[string, TitledAction, string]>([
    ['own page by its path', page('https://acme.test/pricing'), 'Improve internal links: /pricing'],
    ['the home page', page('https://acme.test/'), 'Improve internal links: Home page (/)'],
    [
      'the home page without a slash',
      page('https://acme.test'),
      'Improve internal links: Home page (/)',
    ],
    [
      'a deep path keeps its first segment and tail',
      page('https://acme.test/blog/2026/11/launch-notes?ref=x'),
      'Improve internal links: /blog/…/launch-notes',
    ],
    [
      'a two-segment path whole, decoded',
      page('https://acme.test/shop/Women%2527s-Dresses'),
      "Improve internal links: /shop/Women's-Dresses",
    ],
    [
      'a page label that is not a URL falls back to its address',
      { ...page('acme.test/page-0', 'improve_existing'), target_url: 'https://acme.test/page-0' },
      'Improve the existing page: /page-0',
    ],
    [
      "another site's page keeps its host and tail",
      {
        target_kind: 'earned_page',
        target_label: 'https://www.thecoffeecompass.net/guides/2026/best-subscriptions',
        approach: 'earned_placement',
      },
      'Earn a placement: thecoffeecompass.net/…/best-subscriptions',
    ],
    [
      'a topic by its label',
      { target_kind: 'planned_page', target_label: 'Cold brew ratios', approach: 'create_new' },
      'Create a new page: Cold brew ratios',
    ],
    [
      'an unknown type: the target alone',
      {
        target_kind: 'query',
        target_label: 'crm pricing',
        approach: 'mystery',
      },
      'crm pricing',
    ],
    ['no type at all: the target alone', page('https://acme.test/pricing', null), '/pricing'],
    [
      "a chat's Action, with only its label",
      { target_label: 'https://acme.test/blog/a/b' },
      'acme.test/…/b',
    ],
  ])('%s', (_, action, title) => {
    expect(actionTitle(action)).toBe(title);
  });

  it('gives the whole target for the tooltip behind a cut title', () => {
    expect(actionTitle(page('https://acme.test/blog/2026/11/launch-notes'), { full: true })).toBe(
      'Improve internal links: https://acme.test/blog/2026/11/launch-notes',
    );
  });
});
