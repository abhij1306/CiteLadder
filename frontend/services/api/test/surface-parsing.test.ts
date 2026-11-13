import { describe, expect, it } from 'vitest';
import {
  parseAds,
  parseOverview,
  parseScraper,
  parseShoppingResults,
  overviewAnswer,
} from '../src/search-surfaces/parsing.ts';
import adsEnvelope from './fixtures/chatgpt-ads/envelope.json' with { type: 'json' };
import fullCards from './fixtures/chatgpt-products/full-cards.json' with { type: 'json' };
import titleTagCards from './fixtures/chatgpt-products/title-tag-cards.json' with { type: 'json' };
const task = (status: number, items?: unknown) => ({
  status_code: 20000,
  tasks: [
    {
      id: 'ours',
      status_code: status,
      cost: 0.0018,
      result: [{ datetime: '2026-01-02 12:00:00 +00:00', items }],
    },
  ],
});
describe('observed surface parsing', () => {
  it('checks envelope and exact task identity before distinguishing pending, absence and failures', () => {
    expect(parseOverview(task(40602), 'ours')).toBe('still_pending');
    expect(parseOverview({ ...task(40602), status_code: 40200 }, 'ours')).toMatchObject({
      outcome: 'provider_error',
      aio_present: null,
      provider_status_code: 40200,
    });
    expect(parseOverview(task(40103), 'ours')).toMatchObject({
      outcome: 'provider_error',
      aio_present: null,
    });
    expect(parseOverview(task(20000, []), 'ours')).toMatchObject({
      outcome: 'no_ai_overview',
      aio_present: false,
      provider_cost_microusd: 1800,
    });
    expect(parseOverview(task(20000, {}), 'ours')).toMatchObject({
      outcome: 'parser_error',
      aio_present: null,
    });
    expect(parseOverview(task(20000, []), 'foreign')).toMatchObject({
      outcome: 'parser_error',
      aio_present: null,
    });
  });
  it('reads nested visible text and tables while keeping reference cards separate from text and inline links', () => {
    const result = parseOverview(
      task(20000, [
        {
          type: 'ai_overview',
          rank_absolute: 2,
          references: [{ url: 'https://publisher.example/ref', title: 'Acme card only' }],
          items: [
            {
              type: 'ai_overview_element',
              text: 'A useful answer',
              markdown: 'duplicate markdown',
              references: [{ url: 'https://publisher.example/ref' }],
              items: [
                {
                  type: 'ai_overview_expanded_element',
                  table: { table_header: ['Brand'], table_content: [['Rival', 'Shoes']] },
                  links: [{ url: 'https://rival.example/shoes', title: 'Shoes' }],
                },
              ],
            },
          ],
        },
      ]),
      'ours',
    );
    if (typeof result === 'string') throw new Error('Expected terminal result');
    expect(result).toMatchObject({
      outcome: 'ai_overview_present',
      aio_serp_position: 2,
      answer_text: 'A useful answer\n\nBrand\n\nRival Shoes',
      links: [{ url: 'https://rival.example/shoes', element_index: 0 }],
      references: [{ url: 'https://publisher.example/ref' }],
      observed_at: new Date('2026-01-02T12:00:00Z'),
    });
    expect(overviewAnswer(result).citations.map((c) => c.url)).toEqual([
      'https://publisher.example/ref',
    ]);
    expect(
      parseOverview(
        task(20000, [
          { type: 'ai_overview', items: [{ type: 'unknown_visible_type', text: 'Acme' }] },
        ]),
        'ours',
      ),
    ).toMatchObject({ outcome: 'parser_error', aio_present: null });
  });
  it('keeps malformed or absent fanout unavailable and canonicalizes nested scraper sources once', () => {
    const payload = (fanout?: unknown) => ({
      status_code: 20000,
      tasks: [
        {
          id: 'ours',
          status_code: 20000,
          result: [
            {
              markdown: 'Observed consumer answer',
              fan_out_queries: fanout,
              sources: [{ url: 'https://publisher.example/a?utm_source=engine', title: 'A' }],
              items: [
                {
                  sources: [
                    { url: 'https://publisher.example/a' },
                    { url: 'https://rival.example/b' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const parsed = parseScraper(payload(['best shoes']), 'ours', 'chatgpt_search');
    if (typeof parsed === 'string') throw new Error('Expected terminal answer');
    expect(parsed.search_events.map((e) => e.query)).toEqual(['best shoes']);
    expect(parsed.citations.map((c) => c.url)).toEqual([
      'https://publisher.example/a',
      'https://rival.example/b',
    ]);
    expect(parseScraper(payload([]), 'ours', 'chatgpt_search')).toMatchObject({
      provider_metadata: { fanout_availability: 'no_exposed_queries', query_text_available: true },
    });
    expect(parseScraper(payload(['', 2]), 'ours', 'chatgpt_search')).toMatchObject({
      provider_metadata: { fanout_availability: 'unavailable', query_text_available: false },
    });
    expect(() => parseScraper(payload(), 'foreign', 'chatgpt_search')).toThrow('parse_error');
  });
  it('reads scraper search results as retrieved, and a page without them as unknown', () => {
    const payload = (searchResults?: unknown) => ({
      status_code: 20000,
      tasks: [
        {
          id: 'ours',
          status_code: 20000,
          result: [
            {
              markdown: 'Observed consumer answer',
              search_results: searchResults,
              sources: [{ url: 'https://publisher.example/a', title: 'A' }],
            },
          ],
        },
      ],
    });
    const read = parseScraper(
      payload([
        { url: 'https://acme.example/pricing?utm_source=engine', title: 'Pricing' },
        { url: 'https://publisher.example/a' },
      ]),
      'ours',
      'chatgpt_search',
    );
    if (typeof read === 'string') throw new Error('Expected terminal answer');
    expect(read.retrieved_sources).toEqual([
      { ordinal: 0, url: 'https://acme.example/pricing', title: 'Pricing', domain: 'acme.example' },
      { ordinal: 1, url: 'https://publisher.example/a', title: '', domain: 'publisher.example' },
    ]);
    const unexposed = parseScraper(payload(), 'ours', 'gemini_consumer');
    if (typeof unexposed === 'string') throw new Error('Expected terminal answer');
    expect(unexposed.retrieved_sources).toBeNull();
  });
  it('reads ChatGPT ads as their own items and never into the answer text or citations', () => {
    const parsed = parseScraper(adsEnvelope, 'ours', 'chatgpt_search');
    if (typeof parsed === 'string') throw new Error('Expected terminal answer');
    expect(parsed.answer_text).toBe('Acme and Rival both make good road shoes.');
    expect(parsed.citations.map((c) => c.url)).toEqual([
      'https://publisher.example/review',
      'https://rival.example/shoes',
    ]);
    expect(parseAds(adsEnvelope)).toEqual({
      ads: [
        {
          rank_absolute: 2,
          rank_group: 1,
          advertiser_name: 'Rival',
          advertiser_domain: 'rival.example',
          landing_url_raw: 'https://shop.rival.example/runner-3?gclid=abc&utm_campaign=ai#reviews',
          landing_url_canonical: 'https://shop.rival.example/runner-3',
          title: 'Rival Runner 3',
          snippet: 'Free returns on every pair.',
          image_url: 'https://cdn.ads.example/rival.png',
        },
        {
          rank_absolute: 3,
          rank_group: 2,
          advertiser_name: 'acme.example',
          advertiser_domain: 'acme.example',
          landing_url_raw: 'https://acme.example/trail',
          landing_url_canonical: 'https://acme.example/trail',
          title: 'Acme Trail',
          snippet: '',
          image_url: null,
        },
      ],
      skipped: 2,
    });
  });
  it('tells an answer with no ads from an envelope that cannot be read for ads', () => {
    const page = { markdown: 'Plain answer', items: [{ type: 'chat_gpt_text', markdown: 'x' }] };
    const envelope = (result: unknown[]) => ({
      status_code: 20000,
      tasks: [{ id: 'ours', status_code: 20000, result }],
    });
    expect(parseAds(envelope([page]))).toEqual({ ads: [], skipped: 0 });
    expect(parseAds(envelope([]))).toBeNull();
    expect(parseAds({ status_code: 20000, tasks: [] })).toBeNull();
  });
});
describe('ChatGPT shopping carousel parsing', () => {
  it('reads every field a full product card carries, positioned within its carousel', () => {
    const cards = parseShoppingResults(fullCards);
    expect(cards.map((card) => [card.position, card.title, card.price, card.domain])).toEqual([
      [1, "Nike Men's Winflo 12 Road Running Shoes in Grey, Size: 14 | …", 110, 'www.nike.com'],
      [2, 'Brooks Revel 9 Mens Soft-Cushioned Running Shoes', 100, 'store.fleetfeet.com'],
      [
        3,
        'New Balance 880 Running Shoe in Slate Grey/Reflection at Nor…',
        99.97,
        'www.nordstromrack.com',
      ],
      [
        4,
        "ASICS Gel Contend 10 D Men's Running Shoes | Big 5 Sporting …",
        69.99,
        'www.big5sportinggoods.com',
      ],
      [5, "Nike Men's Downshifter 14 Road Running Shoes in White, Size:…", 49.97, 'www.nike.com'],
    ]);
    expect(cards[0]).toEqual({
      position: 1,
      title: "Nike Men's Winflo 12 Road Running Shoes in Grey, Size: 14 | …",
      tag: 'Best overall value',
      price: 110,
      currency: 'USD',
      merchant_name: 'Nike',
      url: 'https://www.nike.com/t/winflo-12-mens-road-running-shoes-GYVSurvY/HV9272-007?nikegos=true&utm_medium=feed&utm_source=chatgpt.com',
      domain: 'www.nike.com',
      external_product_id: '1015989646-00198966953284',
      image_url: 'https://images.example/card-1.jpg',
    });
    expect(cards[2]).toMatchObject({ tag: null, merchant_name: 'Nordstrom Rack' });
  });
  it('keeps title-and-tag cards with every other field absent, not zero', () => {
    expect(parseShoppingResults(titleTagCards)).toEqual([
      {
        position: 1,
        title: 'Optimum Nutrition Gold Standard 100% Whey',
        tag: 'Best overall value',
        price: null,
        currency: '',
        merchant_name: null,
        url: '',
        domain: '',
        external_product_id: null,
        image_url: 'https://images.example/card-1.jpg?purpose=fullsize',
      },
      {
        position: 2,
        title: 'Transparent Labs Grass-Fed Whey Isolate',
        tag: 'Best premium option',
        price: null,
        currency: '',
        merchant_name: null,
        url: '',
        domain: '',
        external_product_id: null,
        image_url: 'https://images.example/card-2.jpg',
      },
      {
        position: 3,
        title: 'Dymatize ISO100',
        tag: null,
        price: null,
        currency: '',
        merchant_name: null,
        url: '',
        domain: '',
        external_product_id: null,
        image_url: 'https://images.example/card-3.jpg',
      },
      {
        position: 4,
        title: 'Naked Whey',
        tag: null,
        price: null,
        currency: '',
        merchant_name: null,
        url: '',
        domain: '',
        external_product_id: null,
        image_url: 'https://images.example/card-4.jpg',
      },
    ]);
    // The scraper answer still parses with the carousel in the page.
    expect(
      parseScraper(titleTagCards, '11110537-2641-0626-0000-a43fc092bb93', 'chatgpt_search'),
    ).toMatchObject({ logical_engine: 'chatgpt_search' });
  });
  it('gives sponsored cards no organic product or position, and skips untitled cards in place', () => {
    const card = (title: string, extra: Record<string, unknown> = {}) => ({
      type: 'chat_gpt_products_element',
      title,
      ...extra,
    });
    const envelope = {
      status_code: 20000,
      tasks: [
        {
          id: 'ours',
          status_code: 20000,
          result: [
            {
              items: [
                {
                  type: 'chat_gpt_carousel',
                  items: [
                    { type: 'chat_gpt_ad', title: 'Sponsored runner', url: 'https://ad.example/p' },
                  ],
                },
                {
                  type: 'chat_gpt_products',
                  items: [
                    { type: 'chat_gpt_ad', title: 'Sponsored card', url: 'https://ad.example/q' },
                    card(''),
                    card('Organic Runner', { price: '12', merchants: ['Shop'], rating: 4.8 }),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseShoppingResults(envelope)).toEqual([
      {
        position: 2,
        title: 'Organic Runner',
        tag: null,
        price: null,
        currency: '',
        merchant_name: null,
        url: '',
        domain: '',
        external_product_id: null,
        image_url: null,
      },
    ]);
    expect(parseShoppingResults({ status_code: 20000, tasks: [] })).toEqual([]);
  });
});
