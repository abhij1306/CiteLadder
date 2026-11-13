import { describe, expect, it } from 'vite-plus/test';

import type { CommerceProductRow } from '@citeladder/contracts/commerce-suite';

import { productCsv } from './product-columns';

const road: CommerceProductRow = {
  holder_id: '22222222-2222-4222-8222-222222222222',
  kind: 'owned',
  name: 'Acme Road Runner',
  brand: 'Acme',
  url: 'https://shop.example/products/road',
  category_ids: [],
  visibility: 0.75,
  appearances: 3,
  ordered_appearances: 3,
  win_rate: null,
  position: null,
  mentioned_price: { median: 99.5, currency: 'EUR', quoted: 1, other_currency: 0 },
  catalog_price: null,
  merchants: [{ domain: 'runnerstore.com', count: 2 }],
};

describe('productCsv', () => {
  it('exports the shown columns, leaving a missing value empty rather than a word', () => {
    expect(productCsv([road], ['visibility', 'win_rate', 'mentioned_price', 'merchants'])).toEqual({
      headers: [
        'Product',
        'Brand',
        'Holder',
        'URL',
        'Visibility',
        'Win rate',
        'Mentioned price',
        'Merchants',
      ],
      rows: [
        [
          'Acme Road Runner',
          'Acme',
          'Your product',
          'https://shop.example/products/road',
          '75.0%',
          '',
          '€99.50',
          'runnerstore.com (2)',
        ],
      ],
    });
  });

  it('keeps the count of quotes in other currencies, with or without a median', () => {
    const quotedAbroad = (median: number | null): CommerceProductRow => ({
      ...road,
      mentioned_price: {
        median,
        currency: 'EUR',
        quoted: median === null ? 0 : 1,
        other_currency: 2,
      },
    });
    expect(productCsv([quotedAbroad(99.5), quotedAbroad(null)], ['mentioned_price']).rows).toEqual([
      [
        'Acme Road Runner',
        'Acme',
        'Your product',
        'https://shop.example/products/road',
        '€99.50 (+2 in other currencies)',
      ],
      [
        'Acme Road Runner',
        'Acme',
        'Your product',
        'https://shop.example/products/road',
        '(+2 in other currencies)',
      ],
    ]);
  });
});
