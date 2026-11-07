/**
 * The persisted page facts (`site_fetch_artifacts.normalized_facts`) a catalog
 * reader consumes, exactly as the extractor writes them: every field below is
 * always written (`emptyFacts` seeds each one), so a missing or misshapen
 * field is a parse error, never a default. Commerce reads facts through this
 * schema instead of declaring its own copy of Site Health's shape.
 */
import { z } from 'zod';

const texts = z.array(z.string());
const link = z.looseObject({ url: z.string(), title: z.string() });
/** `structuredData().product`: each schema.org Product property's values. */
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
/** `commerceFacts()`; a page whose content was cleared carries no price context. */
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
