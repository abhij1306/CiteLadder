import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  catalogItems,
  keptCategories,
  parsePrice,
  treeProposal,
  type CatalogItem,
} from '../src/commerce/catalog-sources.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/catalog-sources/${name}`, import.meta.url), 'utf8');
const shopify = (store: string) =>
  JSON.stringify({ store, pages: [fixture('shopify-products.json')] });
const items = (list: CatalogItem[]) => list.filter((item) => item.kind === 'item');

describe('the CSV template', () => {
  it('maps the template columns, parses prices and category paths, and rejects rows with their reason', () => {
    expect(catalogItems('csv', fixture('template.csv'))).toEqual([
      {
        kind: 'item',
        row_number: 2,
        values: {
          name: 'Trail Runner',
          brand: 'Acme',
          description: 'Grippy, light trail shoe',
          price: 120,
          currency: 'USD',
          canonical_url: 'https://shop.example/products/trail-runner',
          image_url: 'https://cdn.example/trail.png',
          sku: 'TR-1',
          gtin: '0012345678905',
        },
        variants: [],
        paths: [['Footwear', 'Running', 'Trail'], ['Sale']],
      },
      {
        kind: 'item',
        row_number: 3,
        values: {
          name: 'Road Runner',
          brand: 'Acme',
          price: 89.5,
          currency: 'USD',
          canonical_url: 'https://shop.example/products/road-runner',
          sku: 'RR-1',
        },
        variants: [],
        paths: [['Footwear', 'Running']],
      },
      {
        kind: 'rejected',
        row_number: 4,
        detail: 'Price "$12" is not a number with an optional currency code',
      },
      { kind: 'rejected', row_number: 5, detail: 'title is required' },
    ]);
  });

  it('refuses a file without the required columns or any product', () => {
    expect(() => catalogItems('csv', 'title,price\nShoe,10\n')).toThrow(
      'The CSV template needs these columns: brand',
    );
    expect(() => catalogItems('csv', 'title,brand\n')).toThrow('The file has no products');
    expect(() => catalogItems('csv', '  ')).toThrow('The file is empty');
  });
});

describe('a Merchant Center feed', () => {
  it('groups an XML item group into one product with its variants and price range', () => {
    const [trail, sock] = items(catalogItems('merchant_center', fixture('merchant-center.xml')));
    expect(trail).toMatchObject({
      row_number: 1,
      values: {
        name: 'Trail Runner - Size 9',
        brand: 'Acme',
        price: 119,
        price_max: 129,
        currency: 'EUR',
        sku: 'TR-1',
        image_url: 'https://cdn.example/trail.png',
      },
      paths: [['Footwear', 'Running', 'Trail']],
    });
    expect(trail?.kind === 'item' && trail.variants.map((v) => [v.sku, v.gtin, v.price])).toEqual([
      ['TR-1-9', '0012345678905', 119],
      ['TR-1-10', '0012345678912', 129],
    ]);
    // A lone item keeps its own identifiers and a single price.
    expect(sock).toEqual({
      kind: 'item',
      row_number: 3,
      values: {
        name: 'Wool Sock',
        brand: 'Acme',
        price: 12,
        currency: 'EUR',
        canonical_url: 'https://shop.example/products/sock',
        sku: 'SK-1',
        mpn: 'SOCK-W',
      },
      variants: [],
      paths: [['Accessories']],
    });
  });

  it('reads an Atom feed’s g:link beside the entry’s own link element', () => {
    const atom = [
      '<?xml version="1.0"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">',
      '<entry><title>Wool Sock</title><link href="https://shop.example/feed"/>',
      '<g:id>SK-1</g:id><g:link>https://shop.example/products/sock</g:link>',
      '<g:price>12.00 EUR</g:price></entry>',
      '</feed>',
    ].join('');
    expect(catalogItems('merchant_center', atom)).toEqual([
      {
        kind: 'item',
        row_number: 1,
        values: {
          name: 'Wool Sock',
          price: 12,
          currency: 'EUR',
          canonical_url: 'https://shop.example/products/sock',
          sku: 'SK-1',
        },
        variants: [],
        paths: [],
      },
    ]);
  });

  it('reads Content API JSON and refuses an ambiguous price', () => {
    expect(catalogItems('merchant_center', fixture('merchant-center.json'))).toEqual([
      {
        kind: 'item',
        row_number: 1,
        values: {
          name: 'Wool Sock',
          brand: 'Acme',
          price: 12,
          currency: 'EUR',
          canonical_url: 'https://shop.example/products/sock',
          image_url: 'https://cdn.example/sock.png',
          sku: 'SK-1',
        },
        variants: [],
        paths: [['Accessories', 'Socks']],
      },
      {
        kind: 'rejected',
        row_number: 2,
        detail: 'Price "1,299.00 EUR" is not a number with an optional currency code',
      },
    ]);
  });

  it('reads a tab-separated feed and rejects a group priced in two currencies', () => {
    expect(catalogItems('merchant_center', fixture('merchant-center.tsv'))).toEqual([
      { kind: 'rejected', row_number: 2, detail: 'Variants are priced in different currencies' },
    ]);
  });
});

describe('a Shopify storefront', () => {
  it('turns variants into a price range and product type and tags into categories', () => {
    expect(catalogItems('shopify', shopify('acme.myshopify.com'))).toEqual([
      {
        kind: 'item',
        row_number: 1,
        values: {
          name: 'Trail Runner',
          brand: 'Acme',
          description: 'Grippy & light trail shoe',
          price: 119,
          price_max: 129,
          canonical_url: 'https://acme.myshopify.com/products/trail-runner',
          image_url: 'https://cdn.shopify.example/trail.png',
        },
        variants: [
          { title: '9', sku: 'TR-1-9', gtin: '0012345678905', price: 119, url: '' },
          { title: '10', sku: 'TR-1-10', gtin: '0012345678912', price: 129, url: '' },
        ],
        paths: [['Running Shoes'], ['Trail'], ['Sale']],
      },
      {
        kind: 'item',
        row_number: 2,
        values: {
          name: 'Wool Sock',
          brand: 'Acme',
          price: 12,
          canonical_url: 'https://acme.myshopify.com/products/wool-sock',
          sku: 'SK-1',
        },
        variants: [],
        paths: [],
      },
    ]);
  });
  it('reads a description as the visible text of its HTML', () => {
    const page = JSON.stringify({
      products: [
        {
          title: 'Café Mug',
          handle: 'cafe-mug',
          body_html:
            '<p title="a > b">Caf&eacute; &lt;mug&gt;&nbsp;&mdash; it&apos;s</p><script>track("x")</script><style>p{}</style><p>500&nbsp;ml',
          variants: [],
        },
      ],
    });
    const [item] = catalogItems('shopify', JSON.stringify({ store: 'acme.com', pages: [page] }));
    expect(item).toMatchObject({ values: { description: "Café <mug> — it's 500 ml" } });
  });
});

describe('prices and the category tree', () => {
  it('reads a currency code on either side and never guesses', () => {
    expect(parsePrice('59.00 EUR')).toEqual({ amount: 59, currency: 'EUR' });
    expect(parsePrice('eur 59')).toEqual({ amount: 59, currency: 'EUR' });
    expect(parsePrice('59.5')).toEqual({ amount: 59.5, currency: '' });
    expect(() => parsePrice('USD 59 EUR')).toThrow('Price names two currencies');
    expect(() => parsePrice('59,00')).toThrow('is not a number');
  });

  it('proposes one tree depth-first and keeps each path up to an excluded category', () => {
    const parsed = catalogItems('csv', fixture('template.csv'));
    expect(
      treeProposal(parsed, new Set(['footwear'])).map((node) => [
        node.name,
        node.parent_key,
        node.depth,
        node.product_count,
        node.existing,
      ]),
    ).toEqual([
      ['Footwear', null, 0, 2, true],
      ['Running', 'footwear', 1, 2, false],
      ['Trail', 'running', 2, 1, false],
      ['Sale', null, 0, 1, false],
    ]);
    const [trail] = items(parsed);
    expect(trail?.kind === 'item' && keptCategories(trail.paths, new Set(['running']))).toEqual([
      'Footwear',
      'Sale',
    ]);
  });
});
