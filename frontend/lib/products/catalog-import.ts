/**
 * Browser-side helpers for the Add products dialog: the sample CSV for each
 * file source and the category review.
 */
import { CATALOG_TEMPLATE_COLUMNS } from '@citeladder/contracts/commerce-requests';
import type { CatalogCategoryProposal } from '@citeladder/contracts/commerce-suite';

/** A downloadable sample: its file name, header and example rows in column order. */
export type SampleCsv = {
  filename: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

/** One example row under the template header, in column order. */
const EXAMPLE: Record<(typeof CATALOG_TEMPLATE_COLUMNS)[number], string> = {
  title: 'Trail Runner',
  brand: 'Your brand',
  description: 'Light trail running shoe',
  price: '120.00',
  currency: 'USD',
  link: 'https://www.example.com/products/trail-runner',
  image_link: 'https://www.example.com/images/trail-runner.jpg',
  category: 'Footwear > Running',
  sku: 'TR-001',
  gtin: '',
};

/** The CSV template: the header and one example row. */
export const CATALOG_SAMPLE: SampleCsv = {
  filename: 'catalog-sample.csv',
  columns: CATALOG_TEMPLATE_COLUMNS,
  rows: [CATALOG_TEMPLATE_COLUMNS.map((column) => EXAMPLE[column])],
};

/**
 * A Merchant Center feed as CSV, by Google's field names: two sizes of one
 * product grouped by `item_group_id`, and a lone product.
 */
export const MERCHANT_FEED_SAMPLE: SampleCsv = {
  filename: 'merchant-feed-sample.csv',
  columns: [
    'id',
    'item_group_id',
    'title',
    'brand',
    'description',
    'price',
    'link',
    'image_link',
    'product_type',
    'gtin',
  ],
  rows: [
    [
      'TR-001-42',
      'TR-001',
      'Trail Runner',
      'Your brand',
      'Light trail running shoe',
      '120.00 USD',
      'https://www.example.com/products/trail-runner?size=42',
      'https://www.example.com/images/trail-runner.jpg',
      'Footwear > Running',
      '',
    ],
    [
      'TR-001-43',
      'TR-001',
      'Trail Runner',
      'Your brand',
      'Light trail running shoe',
      '120.00 USD',
      'https://www.example.com/products/trail-runner?size=43',
      'https://www.example.com/images/trail-runner.jpg',
      'Footwear > Running',
      '',
    ],
    [
      'RS-002',
      '',
      'Running Socks',
      'Your brand',
      'Cushioned running socks',
      '12.00 USD',
      'https://www.example.com/products/running-socks',
      'https://www.example.com/images/running-socks.jpg',
      'Footwear > Accessories',
      '',
    ],
  ],
};

/**
 * The proposed categories left out: each one the person unticked and every
 * category under it, since a product joins a path only up to its first
 * left-out category.
 */
export function leftOutCategories(
  tree: readonly CatalogCategoryProposal[],
  unticked: ReadonlySet<string>,
): Set<string> {
  const parents = new Map(tree.map((node) => [node.key, node.parent_key]));
  const out = new Set<string>();
  for (const node of tree) {
    const seen = new Set<string>();
    for (let key: string | null = node.key; key && !seen.has(key); key = parents.get(key) ?? null) {
      seen.add(key);
      if (unticked.has(key)) {
        out.add(node.key);
        break;
      }
    }
  }
  return out;
}
