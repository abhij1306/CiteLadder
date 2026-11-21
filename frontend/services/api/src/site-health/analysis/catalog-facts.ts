import { z } from 'zod';

const texts = z.array(z.string());
const link = z.looseObject({ url: z.string(), title: z.string() });
const product = z.looseObject({
  name: texts,
  description: texts,
  brand: texts,
  price: texts,
  price_currency: texts,
  sku: texts,
  gtin: texts,
  mpn: texts,
  category: texts,
  availability: texts,
  variants: texts,
});
const commerce = z.looseObject({
  breadcrumbs: texts,
  breadcrumb_links: z.array(link),
  product_cards: z.array(link),
  category_role: z.string(),
  visible_price: z.string(),
  visible_price_context: z.string().optional(),
});
export const catalogFactsSchema = z.looseObject({
  title: z.string(),
  meta_description: z.string(),
  canonical_url: z.string(),
  structured_data: z.looseObject({ product }),
  commerce,
  headings: z.looseObject({ h1_texts: texts }),
  links: z.looseObject({
    anchors: z.array(z.looseObject({ url: z.string(), region: z.string() })),
  }),
});
export type CatalogFacts = z.output<typeof catalogFactsSchema>;
