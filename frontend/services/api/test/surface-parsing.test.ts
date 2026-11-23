import { describe, expect, it } from 'vitest';
import { parseOverview, overviewAnswer } from '../src/search-surfaces/parsing.ts';
import {
  parseAds,
  parseScraper,
  parseShoppingResults,
} from '../src/search-surfaces/scraper-parsing.ts';
import adsEnvelope from './fixtures/chatgpt-ads/envelope.json' with { type: 'json' };
import fullCards from './fixtures/chatgpt-products/full-cards.json' with { type: 'json' };
import titleTagCards from './fixtures/chatgpt-products/title-tag-cards.json' with { type: 'json' };
import mixedOverview from './fixtures/google-ai-overview/mixed-elements.json' with { type: 'json' };
import aiModeAnswer from './fixtures/google-ai-mode/answer.json' with { type: 'json' };
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
    expect(parseOverview('google_ai_overview', task(40602), 'ours')).toBe('still_pending');
    expect(
      parseOverview('google_ai_overview', { ...task(40602), status_code: 40200 }, 'ours'),
    ).toMatchObject({
      outcome: 'provider_error',
      aio_present: null,
      provider_status_code: 40200,
    });
    expect(parseOverview('google_ai_overview', task(40103), 'ours')).toMatchObject({
      outcome: 'provider_error',
      aio_present: null,
    });
    expect(parseOverview('google_ai_overview', task(20000, []), 'ours')).toMatchObject({
      outcome: 'no_ai_overview',
      aio_present: false,
      provider_cost_microusd: 1800,
    });
    expect(parseOverview('google_ai_overview', task(20000, {}), 'ours')).toMatchObject({
      outcome: 'parser_error',
      aio_present: null,
    });
    expect(parseOverview('google_ai_overview', task(20000, []), 'foreign')).toMatchObject({
      outcome: 'parser_error',
      aio_present: null,
    });
  });
  it('keeps malformed overview payloads as parser errors, not absence', () => {
    const numbered = task(20000, []);
    expect(
      parseOverview(
        'google_ai_overview',
        { ...numbered, tasks: [{ ...numbered.tasks[0], id: 7 }] },
        '7',
      ),
    ).toMatchObject({ outcome: 'no_ai_overview', aio_present: false });
    expect(parseOverview('google_ai_overview', null, 'ours')).toMatchObject({
      outcome: 'parser_error',
      raw_payload: { payload: {} },
    });
    expect(parseOverview('google_ai_overview', task(Number.NaN, []), 'ours')).toMatchObject({
      outcome: 'parser_error',
      provider_status_code: null,
    });
    for (const items of [{}, ['loose text'], [{ type: 'ai_overview_element', items: 'x' }, 4]])
      expect(
        parseOverview('google_ai_overview', task(20000, [{ type: 'ai_overview', items }]), 'ours'),
      ).toMatchObject({
        outcome: 'parser_error',
        provider_status_code: 20000,
        aio_present: null,
      });
  });
  it('reads every documented element type, expanded components and per-element references', () => {
    const result = parseOverview('google_ai_overview', mixedOverview, 'ours');
    if (typeof result === 'string') throw new Error('Expected terminal result');
    expect(result).toMatchObject({
      outcome: 'ai_overview_present',
      aio_serp_position: 1,
      answer_text: [
        'Acme and Rival lead for flat feet.',
        'Brand',
        'Arch',
        'Acme High',
        'Rival Medium',
        'Flat feet shoe review',
        'A podiatrist compares stability shoes.',
        'How to choose',
        'Look for firm midsoles.',
        'Fit',
        'Try shoes late in the day.',
        'Replace them every 500 miles.',
      ].join('\n\n'),
      links: [
        { url: 'https://acme.example/stability', element_index: 0 },
        { url: 'https://fit.example/guide', element_index: 3 },
      ],
      observed_at: new Date('2026-01-02T12:00:00Z'),
    });
    expect(overviewAnswer('google_ai_overview', result).citations.map((c) => c.url)).toEqual([
      'https://runner.example/flat-feet',
      'https://lab.example/arch-test',
      'https://fit.example/guide',
    ]);
    expect(
      parseOverview(
        'google_ai_overview',
        task(20000, [
          { type: 'ai_overview', items: [{ type: 'unknown_visible_type', text: 'Acme' }] },
        ]),
        'ours',
      ),
    ).toMatchObject({ outcome: 'parser_error', aio_present: null });
  });
  it('reads a Google AI Mode answer with its shopping cards and without its paid placements', () => {
    const result = parseOverview('google_ai_mode', aiModeAnswer, 'ours');
    if (typeof result === 'string') throw new Error('Expected terminal result');
    expect(result).toMatchObject({
      outcome: 'ai_overview_present',
      aio_present: true,
      aio_serp_position: 1,
      provider_cost_microusd: 1200,
      answer_text: [
        'Acme and Rival lead for stability.',
        'Shoe',
        'Drop',
        'Acme High 10 mm',
        'Top picks',
        'Rival Guide 9',
        'Firm medial post.',
      ].join('\n\n'),
      links: [{ url: 'https://acme.example/stability', element_index: 0 }],
      observed_at: new Date('2026-02-24T14:38:25Z'),
    });
    expect(overviewAnswer('google_ai_mode', result)).toMatchObject({
      logical_engine: 'google_ai_mode',
      transport_model: 'google-ai-mode-serp',
      citations: [
        { ordinal: 0, url: 'https://lab.example/arch-test', domain: 'lab.example' },
        { ordinal: 1, url: 'https://runner.example/stability', domain: 'runner.example' },
      ],
    });
    expect(parseOverview('google_ai_overview', aiModeAnswer, 'ours')).toMatchObject({
      outcome: 'parser_error',
    });
  });
  it('stores no Google AI Mode answer as absent, apart from errors and unknown elements', () => {
    expect(parseOverview('google_ai_mode', task(40102), 'ours')).toMatchObject({
      outcome: 'no_ai_overview',
      aio_present: false,
      provider_status_code: 40102,
    });
    expect(parseOverview('google_ai_overview', task(40102), 'ours')).toMatchObject({
      outcome: 'provider_error',
      aio_present: null,
    });
    expect(parseOverview('google_ai_mode', task(20000, []), 'ours')).toMatchObject({
      outcome: 'no_ai_overview',
      aio_present: false,
    });
    expect(parseOverview('google_ai_mode', task(40103), 'ours')).toMatchObject({
      outcome: 'provider_error',
    });
    expect(
      parseOverview(
        'google_ai_mode',
        task(20000, [{ type: 'ai_overview', items: [{ type: 'unknown_visible_type' }] }]),
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
    expect(unexposed.provider_metadata.search_results).toEqual([]);
  });
  it('reads malformed scraper sources leniently but matches the task identity exactly', () => {
    const envelope = (id: unknown, page: Record<string, unknown>) => ({
      status_code: 20000,
      tasks: [{ id, status_code: 20000, result: [page] }],
    });
    const page = { markdown: 'Answer', sources: ['not a source'], search_results: [3] };
    const read = parseScraper(envelope('ours', page), 'ours', 'chatgpt_search');
    if (typeof read === 'string') throw new Error('Expected terminal answer');
    expect([read.search_used, read.citations, read.retrieved_sources]).toEqual([true, [], []]);
    expect(read.provider_metadata.search_results).toEqual([]);
    const extra = { ...envelope('ours', page), version: '0.1', tasks_count: 1 };
    const kept = parseScraper(extra, 'ours', 'chatgpt_search');
    if (typeof kept === 'string') throw new Error('Expected terminal answer');
    expect(JSON.stringify(kept.provider_metadata.raw_response)).toBe(JSON.stringify(extra));
    const overview = { ...task(20000, []), version: '0.1' };
    const absent = parseOverview('google_ai_overview', overview, 'ours');
    if (typeof absent === 'string') throw new Error('Expected terminal result');
    expect(JSON.stringify(absent.raw_payload)).toBe(JSON.stringify(overview.tasks[0]));
    expect(() => parseScraper(envelope(7, page), '7', 'chatgpt_search')).toThrow('parse_error');
    expect(() =>
      parseScraper(envelope('ours', { markdown: ' ', items: 'x' }), 'ours', 'chatgpt_search'),
    ).toThrow('parse_error');
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
                    'not a card',
                    card('Organic Runner', {
                      price: '12',
                      merchants: ['Shop'],
                      rating: 4.8,
                      images: [5, 'ftp://img.example/a.png', 'https://img.example/b.png'],
                    }),
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
        image_url: 'https://img.example/b.png',
      },
    ]);
    expect(parseShoppingResults({ status_code: 20000, tasks: [] })).toEqual([]);
  });
});
