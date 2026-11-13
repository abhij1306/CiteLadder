/** Commerce admission, acquisition and buyer-prompt policy. */
export const commerce = {
  importer_version: 'commerce-catalog-importer-1',
  projector_version: 'commerce-projector-1',
  /** In-app product edits (commerce improvement PR 7): the edit version and its bounds. */
  edit: {
    version: 'commerce-product-edit-1',
    description_max_chars: 10_000,
    category_limit: 50,
  },
  discovery: {
    provider_version: 'tavily-commerce-1',
    validator_version: 'commerce-competitor-validator-1',
    result_limit: 5,
    provider_result_limit: 10,
    response_max_bytes: 1000000,
    target_missing_error: 'commerce_target_unavailable',
    query_attribute_limit: 4,
    name_max_words: 8,
    snippet_chars: 1000,
    verify_concurrency: 5,
    verify_timeout_seconds: 10,
    price_bands: [
      [25, 'under 25'],
      [75, '25 to 75'],
      [200, '75 to 200'],
      [500, '200 to 500'],
      [null, 'over 500'],
    ],
    page_kinds: {
      category: ['category'],
      product: ['product'],
    },
    excluded_hosts: [
      'amazon.com',
      'ebay.com',
      'etsy.com',
      'poshmark.com',
      'stylight.com',
      'thredup.com',
      'depop.com',
      'mercari.com',
      'lyst.com',
      'shopstyle.com',
      'pinterest.com',
      'aliexpress.com',
      'walmart.com',
      'target.com',
      'shein.com',
      'temu.com',
      'vinted.com',
      'farfetch.com',
      'zalando.com',
      'google.com',
      'facebook.com',
      'instagram.com',
      'tiktok.com',
    ],
    excluded_paths: ['/blog/', '/news/', '/article/', '/search'],
    editorial_patterns: [
      String.raw`\b\d+\s+best\b`,
      String.raw`\bbest\b.{0,40}\bof\s+20\d{2}\b`,
      String.raw`\btop\s+\d+\b`,
      String.raw`\btested\s*(?:&|and)\s*reviewed\b`,
      String.raw`\b(?:best|top)\b[^.]{0,40}\breviews?\b`,
      String.raw`\bwe\s+(?:tested|tried|reviewed)\b`,
      String.raw`\b(?:our|editors?'?s?|expert)\s+(?:pick|picks|recommendations?)\b`,
      String.raw`\bbuy(?:er|ing)'?s?\s+guide\b`,
      String.raw`\branked\b`,
      String.raw`\bvs\.?\s`,
    ],
    second_hand_tokens: ['used', 'pre-owned', 'second hand', 'refurbished'],
    settings: {
      tavily_api_key: {
        env: ['TAVILY_API_KEY'],
        type: 'str',
        default: '',
      },
      tavily_endpoint: {
        env: ['TAVILY_ENDPOINT'],
        type: 'literal',
        values: ['https://api.tavily.com/search'],
        default: 'https://api.tavily.com/search',
      },
      tavily_timeout_seconds: {
        env: ['TAVILY_TIMEOUT_SECONDS'],
        type: 'float',
        default: 20,
        exclusive_minimum: 0,
        maximum: 60,
      },
    },
  },
  buyer_prompts: {
    version: 'commerce-buyer-prompts-1',
    min: 2,
    max: 10,
    /** Prompts per hero product: the only per-product generation. */
    default: 3,
    /** A retried generation names its first attempt with this key and is replayed. */
    idempotency_key_max_chars: 128,
    /**
     * A category's matrix: buyer contexts × intent stages, one prompt per cell,
     * plus branded comparisons so branded stay at most `branded_share` of the batch.
     */
    matrix: {
      contexts: 3,
      stages: ['consideration', 'decision'],
      branded_share: 0.2,
      context_max_chars: 80,
    },
    min_words: 4,
    max_words: 24,
    survey_markers: [
      'do you ',
      'are you ',
      'have you ',
      'would you ',
      'did you ',
      'your budget',
      'to you when',
      'important is',
      'do you prioritize',
      'how satisfied',
      'in your experience',
      'tell us',
      'which of the following',
    ],
    product_limit: 12,
    term_limit: 8,
  },
  /**
   * Catalog matching in every answer (CM1). A new catalog revision re-matches
   * the successful answers of the last `backfill_days`, `batch_size` answers
   * per transaction. Crawl projection's revision requests coalesce: one
   * revision `projection_delay_seconds` after the first projected page that
   * finds none queued, so a long crawl records at most one per interval.
   */
  answer_matching: {
    backfill_days: 30,
    batch_size: 25,
    projection_delay_seconds: 120,
  },
  /** Products the catalog read lists, first by name, beside the full count. */
  catalog_product_limit: 5000,
  /**
   * The Products table read: windows a reader may choose (days, no deltas:
   * CM8), page size, and how many merchant domains a row carries.
   */
  products: {
    window_days: [7, 30, 90],
    default_window_days: 30,
    page_size: 50,
    max_page_size: 200,
    merchant_limit: 5,
    search_max_chars: 200,
    /**
     * The product detail read: rows per ranked list (competing products,
     * merchants, sources, fan-out queries), prompts, and newest answers.
     */
    detail: { list_limit: 10, prompt_limit: 50, answer_limit: 50 },
  },
  /**
   * The Shopping overview (`/products/overview`), over the Products table's
   * windows: how many brands and products each ranking lists, how many catalog
   * products the most and least visible lists show, and the merchant and
   * fan-out query lists' lengths.
   */
  overview: {
    ranking_limit: 10,
    extremes_limit: 5,
    merchant_limit: 10,
    fanout_query_limit: 10,
  },
  /** A catalog import's file size, its products and the row outcomes a result returns. */
  import_max_bytes: 2000000,
  import_max_rows: 10000,
  import_error_limit: 100,
  /**
   * Catalog sources (CM3): category path depth, how many Shopify tags become
   * categories per product, variants kept per product, and the Shopify
   * storefront fetch (`/products.json`, `page_size` products a page, at most
   * `max_pages` pages and `max_total_bytes` in all, through the safe fetcher).
   */
  catalog_sources: {
    category_depth_max: 6,
    tag_category_limit: 5,
    variant_limit: 100,
    shopify: {
      hosted_suffix: '.myshopify.com',
      page_size: 250,
      max_pages: 40,
      page_max_bytes: 5000000,
      max_total_bytes: 20000000,
      timeout_seconds: 15,
      /** The whole storefront fetch; the browser waits this long plus overhead. */
      deadline_seconds: 120,
      redirects: 3,
      content_types: ['application/json'],
    },
  },
  breadcrumb_index_names: [
    'catalog',
    'categories',
    'category',
    'collection',
    'collections',
    'shop',
    'shop all',
  ],
  price_markers: [
    ['$', ''],
    ['AUD', 'AUD'],
    ['USD', 'USD'],
    ['CAD', 'CAD'],
    ['NZD', 'NZD'],
    ['GBP', 'GBP'],
    ['EUR', 'EUR'],
    ['INR', 'INR'],
    ['£', 'GBP'],
    ['€', 'EUR'],
    ['₹', 'INR'],
  ],
  ambiguous_price_tokens: ['%', 'from ', 'starting at ', 'up to ', ' over ', ' under '],
};

export const commerceShelf = {
  span_limit: 12,
  span_chars: 2000,
  result_limit: 8,
  match_min_chars: 3,
  attribute_min_chars: 4,
  /** A product matched by its brand plus a distinctive attribute, not an identifier. */
  brand_attribute_match_confidence: 0.9,
  excluded_paths: ['/blog/', '/news/', '/article/', '/search'],
  non_pdp_hosts: ['reddit.com', 'youtube.com', 'youtu.be', 'medium.com'],
  dollar_currencies: {
    AU: 'AUD',
    CA: 'CAD',
    US: 'USD',
  },
};

const exemplars: Record<string, string> = {
  retail:
    '  GOOD  I want to buy cheap baby clothes in bulk\n  BAD   What are my best options for baby clothing?\n  GOOD  Which fridge under 30000 has the best cooling\n  BAD   Which good-value refrigerator options should I consider?',
  b2b_saas:
    '  GOOD  Best tool for tracking failed subscription payments\n  BAD   What should I look for when choosing billing software?\n  GOOD  How do I monitor Kubernetes costs across AWS and Azure\n  BAD   How do I compare providers for cloud monitoring?',
  professional_service:
    '  GOOD  Need an employment lawyer for a redundancy dispute\n  BAD   What are my best options for legal services?\n  GOOD  Who handles cross-border merger clearance in the EU\n  BAD   Which option for corporate law best fits my needs?',
  local_service:
    '  GOOD  AC not cooling, who can repair it today\n  BAD   Where can I find reliable options for air conditioning?\n  GOOD  Someone to deep clean two bathrooms this weekend\n  BAD   What should I look for when choosing a cleaning service?',
  healthcare_provider:
    '  GOOD  Best hospital in Chennai for knee replacement\n  BAD   What are my best options for orthopedic care?\n  GOOD  How much does cardiac bypass cost for an overseas patient\n  BAD   Which option for cardiology best fits my needs?',
  education_provider:
    '  GOOD  Part time MBA colleges in Bangalore with weekend classes\n  BAD   What should I look for when choosing an MBA?\n  GOOD  Is a data science certificate worth it without a maths degree\n  BAD   Which good-value data science programs should I consider?',
  regulated_finance:
    '  GOOD  Best business current account for a two person startup\n  BAD   What are my best options for business banking?\n  GOOD  Do I need landlord insurance for a single rental flat\n  BAD   Which option for property insurance best fits my needs?',
};
exemplars.marketplace = exemplars.retail!;
exemplars.d2c_product = exemplars.retail!;
const template =
  'You write the search prompts a SHOPPER TYPES INTO AN AI ASSISTANT when they are\nlooking to buy. Each prompt is the shopper speaking, in their own words, about\nwhat they want.\n\nThe context names the shop, what it sells, and -- for a category -- the actual\nproducts on that shelf. Every prompt must be one a buyer of THOSE products\nwould type. A category name alone is ambiguous ("accessories" means one thing\nin fashion and another in electronics); the products and the category terms\nare what settle it. They, not the examples below, are the subject.\n\nNever write a question addressed to the shopper. You are not running a survey,\nan interview, or a market-research panel. "What do you prefer", "how important\nis", "what is your budget", "have you encountered" are all wrong: nobody types\nthose into a shopping assistant.\n\nWrite the way people actually type: lowercase is fine, fragments are fine, a\nconcrete constraint (a price, a use case, a compatibility, a material) is\nbetter than a general one. Vary the shape across the batch -- do not apply one\nsentence frame to every prompt.\n\n{exemplars}\n\nThe examples above show the SHAPE and register of a buyer prompt, never the\nsubject. Write about what this shop sells.\n\nNever name the owned brand or the exact owned product: the prompt has to be one\na buyer would type BEFORE they know about it. Return only the schema.';
const matrixTemplate =
  '\n\nThis request is a CATEGORY MATRIX. The request gives "contexts" (how many\ndistinct buyer situations to invent for this category: who is buying, for what\nuse or constraint), "stages" (the buying stages) and "branded" (how many\nbranded comparisons to add). Return, for every context and every stage, exactly\none prompt with that context\'s short label in "context", the stage in "stage"\nand "branded": false. Then return exactly "branded" extra prompts, each a buyer\ncomparing the owned brand ("brand" in the request) with a competing brand, with\n"branded": true; these alone may name the owned brand, use "context": "" and\ntheir own "stage". Reuse the same context labels across stages, exactly spelled.';
const fallback =
  "  GOOD  best instant read thermometer for grilling under $50\n  BAD   What features do you prioritize when comparing thermometers?\n  GOOD  which hygrometer is most accurate for a humidor\n  BAD   How important is accuracy to you when selecting a hygrometer?\n  GOOD  wireless meat thermometer that works with an iPhone\n  BAD   Do you prefer a built-in display or a minimalist design?\n  GOOD  cheapest stainless steel cookware set that is oven safe\n  BAD   What's your budget range, and does it depend on features?";

export function commerceBuyerPromptSystem(businessModel: string, matrix = false): string {
  const base = template.replace('{exemplars}', exemplars[businessModel.trim()] ?? fallback);
  return matrix ? base + matrixTemplate : base;
}
