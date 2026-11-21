import { z } from 'zod';

import { actionStatusSchema } from './actions.ts';
import { buyerStageSchema } from './project.ts';

const uuid = z.uuid();
export const COMMERCE_TARGETS_MAX = 10;
export const commerceTargetSchema = z.strictObject({
  kind: z.enum(['category', 'product']),
  id: uuid,
});
export const commerceTargetsSchema = z.array(commerceTargetSchema).min(1).max(COMMERCE_TARGETS_MAX);
export const commerceCategoryRoleSchema = z.enum(['hub', 'leaf', 'unknown']);
export const commerceCategorySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  parent_id: uuid.nullable(),
  product_count: z.number().int(),
});
export const commerceProductSchema = z.strictObject({
  id: uuid,
  canonical_url: z.string(),
  name: z.string(),
  brand: z.string(),
  category_ids: z.array(uuid),
});
export const commerceProjectionSchema = z.strictObject({
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']),
  in_flight: z.number().int(),
  failed: z.number().int(),
});
export const commerceCatalogSchema = z.strictObject({
  products: z.array(commerceProductSchema),
  product_total: z.number().int(),
  categories: z.array(commerceCategorySchema),
  projection: commerceProjectionSchema,
});
export const catalogImportSchema = z.strictObject({
  import_id: uuid,
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int(),
  row_outcomes: z.array(
    z.strictObject({
      row_number: z.number().int(),
      status: z.enum(['created', 'updated', 'unchanged', 'rejected']),
      product_id: uuid.nullable(),
      error_code: z.string(),
      detail: z.string(),
    }),
  ),
});
const catalogImportFormatSchema = z.enum(['csv', 'merchant_center', 'shopify']);
const catalogCategoryProposalSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  parent_key: z.string().nullable(),
  depth: z.number().int(),
  product_count: z.number().int(),
  existing: z.boolean(),
});
export const catalogImportStageSchema = z.strictObject({
  import_id: uuid,
  source_format: catalogImportFormatSchema,
  source_label: z.string(),
  products: z.number().int(),
  rejected: z.number().int(),
  categories: z.array(catalogCategoryProposalSchema),
  result: catalogImportSchema.nullable(),
});
export const competitorCandidateSchema = z.strictObject({
  id: uuid,
  target_kind: z.enum(['category', 'product']),
  target_id: uuid,
  canonical_url: z.string(),
  product_name: z.string(),
  brand_name: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  source_kind: z.string(),
  state: z.enum(['pending', 'approved', 'rejected', 'excluded']),
  decision_at: z.string().nullable(),
});
export const competitorDiscoverySchema = z.strictObject({ task_ids: z.array(uuid) });
export const competitorDiscoveryTaskSchema = z.strictObject({
  id: uuid,
  target: commerceTargetSchema,
  status: z.string(),
  error_code: z.string(),
  terminal: z.boolean(),
});
export const buyerPromptSchema = z.strictObject({
  id: uuid,
  prompt_set_id: uuid,
  target: commerceTargetSchema,
  text: z.string(),
  branded: z.boolean(),
  buyer_stage: buyerStageSchema,
  context: z.string(),
  enabled: z.boolean(),
  approved_at: z.string().nullable(),
});
const shelfSnapshotSchema = z.strictObject({
  product_visibility: z.number().nullable(),
  share_of_shelf: z.number().nullable(),
  average_shelf_position: z.number().nullable(),
  first_position_win_rate: z.number().nullable(),
  successful_execution_count: z.number().int(),
  recognized_slot_count: z.number().int(),
  ranked_execution_count: z.number().int(),
  measured_at: z.string(),
});

export const commerceProductSourceSchema = z.enum(['catalog', 'all', 'archived']);
export const commerceLifecycleStateSchema = z.enum(['active', 'archived']);
export const commerceProductSortSchema = z.enum(['visibility', 'win_rate', 'position', 'name']);
export const commerceProductRowSchema = z.strictObject({
  holder_id: uuid,
  kind: z.enum(['owned', 'approved_competitor', 'ai_observed_competitor']),
  name: z.string(),
  brand: z.string(),
  url: z.string(),
  category_ids: z.array(uuid),
  visibility: z.number().nullable(),
  appearances: z.number().int(),
  ordered_appearances: z.number().int(),
  win_rate: z.number().nullable(),
  position: z.number().nullable(),
  mentioned_price: z.strictObject({
    median: z.number().nullable(),
    currency: z.string(),
    quoted: z.number().int(),
    other_currency: z.number().int(),
  }),
  catalog_price: z
    .strictObject({ min: z.number(), max: z.number(), currency: z.string() })
    .nullable(),
  merchants: z.array(z.strictObject({ domain: z.string(), count: z.number().int() })),
});
export const commerceProductPageSchema = z.strictObject({
  window_days: z.number().int(),
  executions: z.number().int(),
  total: z.number().int(),
  items: z.array(commerceProductRowSchema),
  next_cursor: z.string().nullable(),
});

const overviewMetrics = {
  visibility: z.number().nullable(),
  appearances: z.number().int(),
  ordered_appearances: z.number().int(),
  win_rate: z.number().nullable(),
  position: z.number().nullable(),
};
export const commerceOverviewProductSchema = z.strictObject({
  holder_id: uuid,
  kind: commerceProductRowSchema.shape.kind,
  name: z.string(),
  brand: z.string(),
  ...overviewMetrics,
});
export const commerceOverviewBrandSchema = z.strictObject({
  brand: z.string(),
  owned: z.boolean(),
  ...overviewMetrics,
  slots: z.number().int(),
  share_of_shelf: z.number().nullable(),
});
export const commerceShoppingOverviewSchema = z.strictObject({
  window_days: z.number().int(),
  category: uuid.nullable(),
  executions: z.number().int(),
  slots: z.number().int(),
  brands: z.array(commerceOverviewBrandSchema),
  products: z.array(commerceOverviewProductSchema),
  most_visible: z.array(commerceOverviewProductSchema),
  least_visible: z.array(commerceOverviewProductSchema),
  merchants: z.array(
    z.strictObject({ domain: z.string(), answers: z.number().int(), products: z.number().int() }),
  ),
  fanout: z.strictObject({
    answers: z.number().int(),
    answers_with_queries: z.number().int(),
    answers_without_search: z.number().int(),
    queries: z.array(z.strictObject({ query: z.string(), answers: z.number().int() })),
  }),
  category_shelf: shelfSnapshotSchema.nullable(),
});
const holderKindSchema = commerceProductRowSchema.shape.kind;
const positionSchema = z.number().nullable();
export const commerceProductDetailSchema = z.strictObject({
  window_days: z.number().int(),
  executions: z.number().int(),
  product: commerceProductRowSchema.extend({
    description: z.string(),
    image_url: z.string().nullable(),
    catalog: z
      .strictObject({
        lifecycle_state: commerceLifecycleStateSchema,
        price: z.number().nullable(),
        currency: z.string(),
        sku: z.string(),
        gtin: z.string(),
        mpn: z.string(),
        image_url: z.string(),
        categories: z.array(z.string()),
      })
      .nullable(),
  }),
  competing: z.array(
    z.strictObject({
      holder_id: uuid,
      kind: holderKindSchema,
      name: z.string(),
      brand: z.string(),
      shared: z.number().int(),
      ahead: z.number().int(),
      position: positionSchema,
    }),
  ),
  merchants: z.array(z.strictObject({ domain: z.string(), count: z.number().int() })),
  seen_in: z.array(
    z.strictObject({
      target_kind: z.enum(['product', 'category']),
      target_id: uuid,
      name: z.string(),
      answers: z.number().int(),
    }),
  ),
  sources: z.array(
    z.strictObject({
      url: z.string(),
      title: z.string(),
      domain: z.string(),
      count: z.number().int(),
    }),
  ),
  fan_out_queries: z.array(z.strictObject({ query: z.string(), count: z.number().int() })),
  prompts: z.array(
    z.strictObject({
      prompt_id: uuid.nullable(),
      text: z.string(),
      executions: z.number().int(),
      appearances: z.number().int(),
      visibility: z.number().nullable(),
      win_rate: z.number().nullable(),
      position: positionSchema,
    }),
  ),
  answers: z.array(
    z.strictObject({
      task_id: uuid,
      audit_id: uuid,
      prompt_text: z.string(),
      engine: z.string(),
      completed_at: z.string(),
      rank: z.number().int().nullable(),
      outcome: z.enum(['won', 'lost', 'unranked']),
    }),
  ),
  answer_total: z.number().int(),
  actions: z.array(z.strictObject({ id: uuid, title: z.string(), status: actionStatusSchema })),
});

export type CommerceTarget = z.infer<typeof commerceTargetSchema>;
export type CommerceShoppingOverview = z.infer<typeof commerceShoppingOverviewSchema>;
export type CommerceOverviewProduct = z.infer<typeof commerceOverviewProductSchema>;
export type CommerceOverviewBrand = z.infer<typeof commerceOverviewBrandSchema>;
export type CommerceProductSource = z.infer<typeof commerceProductSourceSchema>;
export type CommerceLifecycleState = z.infer<typeof commerceLifecycleStateSchema>;
export type CommerceProductSort = z.infer<typeof commerceProductSortSchema>;
export type CommerceProductRow = z.infer<typeof commerceProductRowSchema>;
export type CommerceProductPage = z.infer<typeof commerceProductPageSchema>;
export type CommerceCatalog = z.infer<typeof commerceCatalogSchema>;
export type CommerceProduct = z.infer<typeof commerceProductSchema>;
export type CommerceProjection = z.infer<typeof commerceProjectionSchema>;
export type CatalogImport = z.infer<typeof catalogImportSchema>;
export type CatalogImportStage = z.infer<typeof catalogImportStageSchema>;
export type CatalogCategoryProposal = z.infer<typeof catalogCategoryProposalSchema>;
export type CompetitorCandidate = z.infer<typeof competitorCandidateSchema>;
export type CompetitorDiscoveryTask = z.infer<typeof competitorDiscoveryTaskSchema>;
export type BuyerPrompt = z.infer<typeof buyerPromptSchema>;
export type CommerceProductDetail = z.infer<typeof commerceProductDetailSchema>;
