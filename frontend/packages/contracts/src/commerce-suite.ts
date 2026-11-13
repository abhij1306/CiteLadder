import { z } from 'zod';

import { actionStatusSchema } from './actions.ts';
import { buyerStageSchema } from './project.ts';

const uuid = z.uuid();
/** Targets one discovery or prompt-generation request may name: each is a paid search or model call. */
export const COMMERCE_TARGETS_MAX = 10;
export const commerceTargetSchema = z.strictObject({
  kind: z.enum(['category', 'product']),
  id: uuid,
});
/** The targets one discovery or prompt-generation request names. */
export const commerceTargetsSchema = z.array(commerceTargetSchema).min(1).max(COMMERCE_TARGETS_MAX);
export const commerceCategoryRoleSchema = z.enum(['hub', 'leaf', 'unknown']);
/**
 * The catalog list is navigation: each row carries what the rail and the
 * catalog-choice tool render, never the row's evidence (attributes, variants,
 * field sources), which stays on the stored row and the frozen audit context.
 */
export const commerceCategorySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  /** The category one level up; null at the top of the tree. */
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
/** Projection progress, read alone while projections are in flight. */
export const commerceProjectionSchema = z.strictObject({
  /**
   * Whether crawled pages project into the catalog: only catalog-selling
   * business models. `unknown` when no recognized model is confirmed yet;
   * projection fails closed then, but the state is not "not applicable".
   */
  applicability: z.enum(['applicable', 'not_applicable', 'unknown']),
  in_flight: z.number().int(),
  /** Failed or cancelled projections of the latest projected crawl. */
  failed: z.number().int(),
});
export const commerceCatalogSchema = z.strictObject({
  /** The first configured number of products by name; `product_total` counts them all. */
  products: z.array(commerceProductSchema),
  product_total: z.number().int(),
  categories: z.array(commerceCategorySchema),
  projection: commerceProjectionSchema,
});
/** An applied import's results; `row_outcomes` lists rejected rows first, each with its reason. */
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
/** One category of a staged import's proposed tree, by its category key. */
const catalogCategoryProposalSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  /** The key one level up; null at the top. */
  parent_key: z.string().nullable(),
  depth: z.number().int(),
  /** Products of this import the category would hold. */
  product_count: z.number().int(),
  /** Whether the catalog already has a category by this name. */
  existing: z.boolean(),
});
/**
 * A staged catalog import: what it would write, shown for review before the
 * products go live. `result` is set once it was applied (the same content
 * imported again returns the earlier import).
 */
export const catalogImportStageSchema = z.strictObject({
  import_id: uuid,
  source_format: catalogImportFormatSchema,
  /** The file name, or the Shopify store host. */
  source_label: z.string(),
  /** Products the import would add or update. */
  products: z.number().int(),
  /** Rows that cannot be imported, before any matching. */
  rejected: z.number().int(),
  /** The proposed category tree, depth-first by name. */
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
  /** A comparison that names the owned brand; the only prompts allowed to. */
  branded: z.boolean(),
  /** The intent stage: a matrix cell's stage, `consideration` for a hero product, empty when manual. */
  buyer_stage: buyerStageSchema,
  /** The category matrix's buyer context; empty outside a matrix. */
  context: z.string(),
  enabled: z.boolean(),
  approved_at: z.string().nullable(),
});
/** The latest measured snapshot of one target. */
const shelfSnapshotSchema = z.strictObject({
  /** Null when no execution for the target succeeded: unavailable, not zero. */
  product_visibility: z.number().nullable(),
  share_of_shelf: z.number().nullable(),
  average_shelf_position: z.number().nullable(),
  first_position_win_rate: z.number().nullable(),
  successful_execution_count: z.number().int(),
  recognized_slot_count: z.number().int(),
  ranked_execution_count: z.number().int(),
  measured_at: z.string(),
});

/**
 * Which holders the Products table lists: the active catalog alone, with
 * competitors (CM6), or the archived catalog products alone.
 */
export const commerceProductSourceSchema = z.enum(['catalog', 'all', 'archived']);
/** A catalog product is active, or archived: out of the catalog, matching and prompts, history kept. */
export const commerceLifecycleStateSchema = z.enum(['active', 'archived']);
/** The Products table's sort keys; each has one direction (best first, then name). */
export const commerceProductSortSchema = z.enum(['visibility', 'win_rate', 'position', 'name']);
/**
 * One product holder's metrics over the filtered executions (formula version
 * 1). Each holder holds at most one slot per execution, at its best rank.
 * Null is unavailable or unknown, never zero.
 */
export const commerceProductRowSchema = z.strictObject({
  /** The product id for `owned`, the competitor candidate id otherwise. */
  holder_id: uuid,
  kind: z.enum(['owned', 'approved_competitor', 'ai_observed_competitor']),
  name: z.string(),
  brand: z.string(),
  url: z.string(),
  category_ids: z.array(uuid),
  /** Executions with a slot ÷ executions in scope; null with no execution in scope. */
  visibility: z.number().nullable(),
  /** Executions with a slot; 0 is a real zero. */
  appearances: z.number().int(),
  /** Appearances in an ordered answer, the denominator of win rate and position. */
  ordered_appearances: z.number().int(),
  /** Ordered appearances at rank 1 ÷ ordered appearances; null with none. */
  win_rate: z.number().nullable(),
  /** Mean best rank over ordered appearances; null with none. */
  position: z.number().nullable(),
  mentioned_price: z.strictObject({
    /** Median quoted price in `currency`; null when none was quoted in it. */
    median: z.number().nullable(),
    /** The catalog currency, else the most quoted one; empty when unknown. */
    currency: z.string(),
    /** Executions that quoted a price in `currency`. */
    quoted: z.number().int(),
    /** Executions that quoted a price in another currency: counted, not converted. */
    other_currency: z.number().int(),
  }),
  /** The catalog price or min–max across variants; null when the catalog has none. */
  catalog_price: z
    .strictObject({ min: z.number(), max: z.number(), currency: z.string() })
    .nullable(),
  /** Merchant domains the answers send shoppers to, by executions, most first. */
  merchants: z.array(z.strictObject({ domain: z.string(), count: z.number().int() })),
});
export const commerceProductPageSchema = z.strictObject({
  window_days: z.number().int(),
  /** Successful matched executions in scope: the visibility denominator. */
  executions: z.number().int(),
  /** Holders matching the filters, across every page. */
  total: z.number().int(),
  items: z.array(commerceProductRowSchema),
  next_cursor: z.string().nullable(),
});

/**
 * A ranked holder's metrics over the window (formula version 1). Null is
 * unavailable, never zero.
 */
const overviewMetrics = {
  /** Executions with a slot ÷ executions in scope; null with no execution in scope. */
  visibility: z.number().nullable(),
  /** Executions with a slot; 0 is a real zero. */
  appearances: z.number().int(),
  ordered_appearances: z.number().int(),
  /** Ordered appearances at rank 1 ÷ ordered appearances; null with none. */
  win_rate: z.number().nullable(),
  /** Mean best rank over ordered appearances; null with none. */
  position: z.number().nullable(),
};
export const commerceOverviewProductSchema = z.strictObject({
  holder_id: uuid,
  kind: commerceProductRowSchema.shape.kind,
  name: z.string(),
  brand: z.string(),
  ...overviewMetrics,
});
/** A brand: its products' slots folded to one per execution, at the best rank. */
export const commerceOverviewBrandSchema = z.strictObject({
  brand: z.string(),
  /** A catalog product carries this brand. */
  owned: z.boolean(),
  ...overviewMetrics,
  /** Product slots this brand holds, the Share of Shelf numerator. */
  slots: z.number().int(),
  /** Its slots ÷ every product slot in scope; null when no answer held a product. */
  share_of_shelf: z.number().nullable(),
});
/** The Shopping overview: rankings, extremes, merchants and fan-out for one window. */
export const commerceShoppingOverviewSchema = z.strictObject({
  window_days: z.number().int(),
  /** The category filter, or null for the whole catalog and its competitors. */
  category: uuid.nullable(),
  /** Successful matched executions in scope: the visibility denominator. */
  executions: z.number().int(),
  /** Product slots across those executions, the Share of Shelf denominator. */
  slots: z.number().int(),
  /** Brands by appearances; holders with no brand are left out. */
  brands: z.array(commerceOverviewBrandSchema),
  /** Every product holder (catalog and competitors) by appearances. */
  products: z.array(commerceOverviewProductSchema),
  /** Catalog products most and least visible; the two lists never share a product. */
  most_visible: z.array(commerceOverviewProductSchema),
  least_visible: z.array(commerceOverviewProductSchema),
  /** Merchant domains the answers send shoppers to, by executions. */
  merchants: z.array(
    z.strictObject({ domain: z.string(), answers: z.number().int(), products: z.number().int() }),
  ),
  fanout: z.strictObject({
    /** Executions whose answer held a product. */
    answers: z.number().int(),
    /** Of those, executions whose latest analysis captured the search queries' text. */
    answers_with_queries: z.number().int(),
    /**
     * Of those, executions that ran no search. The rest searched without
     * exposing their queries, or have no analysis yet: unknown, never zero.
     */
    answers_without_search: z.number().int(),
    queries: z.array(z.strictObject({ query: z.string(), answers: z.number().int() })),
  }),
  /**
   * The category-target metrics of the category's latest Commerce audit; null
   * without a category filter or before any audit measured it.
   */
  category_shelf: shelfSnapshotSchema.nullable(),
});
const holderKindSchema = commerceProductRowSchema.shape.kind;
/** Mean best rank over ordered appearances; null with none. */
const positionSchema = z.number().nullable();
/**
 * One product holder's page (commerce improvement PR 4): its Products row and
 * the answers behind it, over the same window, engine and prompt set. Every
 * list is bounded by configuration, most first; `answer_total` counts every
 * answer it appeared in.
 */
export const commerceProductDetailSchema = z.strictObject({
  window_days: z.number().int(),
  /** Successful matched executions in scope: the visibility denominator. */
  executions: z.number().int(),
  product: commerceProductRowSchema.extend({
    /** The catalog description; empty for a competitor or when the catalog has none. */
    description: z.string(),
    /**
     * The catalog image (imported or edited), else that of its latest
     * shopping card in an answer; null when neither has one.
     */
    image_url: z.string().nullable(),
    /** The editable catalog record of an owned product; null for a competitor. */
    catalog: z
      .strictObject({
        lifecycle_state: commerceLifecycleStateSchema,
        price: z.number().nullable(),
        currency: z.string(),
        sku: z.string(),
        gtin: z.string(),
        mpn: z.string(),
        /** The catalog image an import or edit set; empty when none did. */
        image_url: z.string(),
        /** Its category names, by name. */
        categories: z.array(z.string()),
      })
      .nullable(),
  }),
  /** Holders that held a slot in the same executions, by shared executions. */
  competing: z.array(
    z.strictObject({
      holder_id: uuid,
      kind: holderKindSchema,
      name: z.string(),
      brand: z.string(),
      /** Executions both held a slot in. */
      shared: z.number().int(),
      /** Shared executions where it ranked above this product (or this one was unranked). */
      ahead: z.number().int(),
      /** Its mean best rank over the shared ordered executions. */
      position: positionSchema,
    }),
  ),
  /** Merchant domains the answers send shoppers to for it, by executions. */
  merchants: z.array(z.strictObject({ domain: z.string(), count: z.number().int() })),
  /** Pages cited by the executions it appeared in, by executions. */
  sources: z.array(
    z.strictObject({
      url: z.string(),
      title: z.string(),
      domain: z.string(),
      count: z.number().int(),
    }),
  ),
  /** Search queries those executions ran (fan-out), by executions. */
  fan_out_queries: z.array(z.strictObject({ query: z.string(), count: z.number().int() })),
  /** Prompts it appeared for, or that target it, with its metrics over each prompt's executions. */
  prompts: z.array(
    z.strictObject({
      /** Null for an execution whose prompt was deleted; its text remains. */
      prompt_id: uuid.nullable(),
      text: z.string(),
      executions: z.number().int(),
      appearances: z.number().int(),
      visibility: z.number().nullable(),
      win_rate: z.number().nullable(),
      position: positionSchema,
    }),
  ),
  /** The executions it appeared in, newest first. */
  answers: z.array(
    z.strictObject({
      task_id: uuid,
      audit_id: uuid,
      prompt_text: z.string(),
      engine: z.string(),
      completed_at: z.string(),
      /** Its best rank in an ordered answer; null when the answer did not order it. */
      rank: z.number().int().nullable(),
      /** `won` at rank 1, `lost` ranked below another, `unranked` without an order. */
      outcome: z.enum(['won', 'lost', 'unranked']),
    }),
  ),
  answer_total: z.number().int(),
  /** Actions not yet done or dismissed whose evidence targets this owned product. */
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
