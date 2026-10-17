/** Opportunity catalog: deterministic decisions over persisted evidence. */
import type { ExpectedCheck } from '@citeladder/contracts/opportunities';

export const opportunityDeclaration = { output_phase_outline: 'outline' };

export const opportunities = {
  ANALYZER_VERSION: 'opp-analyzer-1',
  RULE_VERSION: 'opp-rules-1',
  FORMULA_VERSION: 'opp-formula-1',
  CODE_IMPLEMENTATION_IDEMPOTENCY_CONFLICT: 'implementation_idempotency_conflict',
  CODE_IMPLEMENTATION_TARGET_CONFLICT: 'implementation_target_conflict',
  CODE_OPPORTUNITY_ORDER_CONFLICT: 'opportunity_order_conflict',
  RULE_PRODUCT_NOT_MENTIONED: 'product_not_mentioned',
  RULE_CITED_ALTERNATIVES: 'cited_alternatives_without_uploaded_presence',
  RULE_CATALOG_FIELDS_MISSING: 'catalog_fields_missing',
  // A confirmed decline already passed the audit's materiality and agreement
  // gates, so confidence and size rank it and never drop it below the floor.
  CONFIRMED_DECLINE_CONFIDENCE_FLOOR: 0.5,
  CONFIRMED_DECLINE_GAP_CAP: 2,
  DEMAND_SIGNAL_GAP_FACTOR: 2,
  OPPORTUNITY_TYPE_VISIBILITY: 'visibility',
  OPPORTUNITY_TYPE_COMMERCE: 'commerce',
  OPPORTUNITY_TYPE_SITE: 'site',
  OPPORTUNITY_TYPE_TRAFFIC: 'traffic',
  OPPORTUNITY_TYPE_TOPIC: 'topic',
  OPPORTUNITY_TYPES: ['commerce', 'site', 'topic', 'traffic', 'visibility'],
  OPPORTUNITY_SEVERITIES: ['critical', 'high', 'info', 'low', 'medium'],
  IMPLEMENTATION_IDEMPOTENCY_KEY_MAX_LEN: 160,
  IMPLEMENTATION_TARGETS_MAX: 64,
  IMPLEMENTATION_VERIFIER_VERSION: 'implementation-verifier-1',
  IMPLEMENTATION_VERIFICATION_BATCH_MAX: 100,
  IMPLEMENTATION_VERIFICATION_HISTORY_MAX: 50,
  // New evidence re-checks a declaration only this long after it went live;
  // after that its last observation stands. Declarations may be backdated by
  // at most the same span, and never placed in the future beyond the skew.
  VERIFICATION_WINDOW_DAYS: 30,
  // A new page takes longer to rank than an edited one takes to recrawl.
  CHECK_KIND_WINDOW_DAYS: { keyword_presence: 90 } satisfies Partial<
    Record<ExpectedCheck['kind'], number>
  >,
  DECLARATION_FUTURE_SKEW_SECONDS: 300,
  VISIBILITY_METRIC_PROMPT_SCORE: 'prompt_score',
  VISIBILITY_CHECK_MIN_DELTA: 1,
  TRAFFIC_METRIC_CLICKS: 'clicks',
  // Clicks per day: sync windows differ in length, so windows compare as rates.
  TRAFFIC_CHECK_MIN_DAILY_GAIN: 0.1,
  OPPORTUNITY_RULES_BY_ID: {
    brand_absent_high_value_prompt: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'visibility',
      remediation:
        'Publish or update an owned page that directly answers this prompt: lead with a clear, quotable definition, then add structured data so answer engines can attribute it. Re-run an audit to confirm owned citations appear.',
      rule_id: 'brand_absent_high_value_prompt',
      severity: 'high',
      title: 'Brand absent on high-value prompt',
    },
    owned_page_not_cited: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'visibility',
      remediation:
        'Strengthen the owned page that should win this prompt: align its title, headings, and opening answer with the prompt intent so answer engines have a citable owned source.',
      rule_id: 'owned_page_not_cited',
      severity: 'medium',
      title: 'Owned page not cited for target prompt',
    },
    confirmed_prompt_decline: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'visibility',
      remediation:
        'Refresh the owned page that best answers this prompt. Lead with a direct answer, close the measured visibility or citation gap, and use this opportunity as evidence context for Content generation.',
      rule_id: 'confirmed_prompt_decline',
      severity: 'high',
      title: 'Prompt visibility has a confirmed decline',
    },
    missing_structured_data: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        "Add schema.org structured data (JSON-LD preferred) so answer engines can parse and attribute the page's content.",
      rule_id: 'missing_structured_data',
      severity: 'medium',
      title: 'Missing structured data on owned page',
    },
    schema_properties_incomplete: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        "Complete the required and recommended properties for the page's expected schema type, using the exact missing-property evidence as the implementation checklist.",
      rule_id: 'schema_properties_incomplete',
      severity: 'medium',
      title: 'Schema properties are incomplete',
    },
    schema_visible_content_conflict: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Align the visible title, headings, and page claims with the corresponding schema.org values; do not leave competing facts for answer engines to resolve.',
      rule_id: 'schema_visible_content_conflict',
      severity: 'high',
      title: 'Visible content conflicts with schema',
    },
    content_structure_incomplete: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        "Strengthen the page's substantive content, answer-first opening, and question-led headings using the persisted rule evidence.",
      rule_id: 'content_structure_incomplete',
      severity: 'low',
      title: 'Answer-oriented content structure is incomplete',
    },
    citability_trust_incomplete: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Add the missing author, date, source, or organization identity signals so readers and answer engines can assess provenance.',
      rule_id: 'citability_trust_incomplete',
      severity: 'medium',
      title: 'Citability and trust signals are incomplete',
    },
    product_not_mentioned: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'commerce',
      remediation:
        "No answer engine mentioned this product anywhere in the latest audit. Add product-named prompts that mirror how buyers ask, and strengthen the product's owned pages with quotable specs, pricing, and comparisons so engines have a citable source.",
      rule_id: 'product_not_mentioned',
      severity: 'high',
      title: 'Catalog product never mentioned by answer engines',
    },
    cited_alternatives_without_uploaded_presence: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'commerce',
      remediation:
        'Third-party sources were cited for this category while no uploaded product or uploaded product destination appeared. Strengthen the uploaded product pages with clear, citable comparison evidence.',
      rule_id: 'cited_alternatives_without_uploaded_presence',
      severity: 'high',
      title: 'Cited alternatives appear without uploaded products',
    },
    catalog_fields_missing: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'commerce',
      remediation:
        'Complete the named catalog fields so product identity, availability, and destination evidence are explicit.',
      rule_id: 'catalog_fields_missing',
      severity: 'medium',
      title: 'Catalog fields are missing',
    },
    search_demand_content_gap: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Improve the matching owned page and search snippet for this measured query or page. Keep the answer aligned with the observed intent and verify the later GSC window.',
      rule_id: 'search_demand_content_gap',
      severity: 'medium',
      title: 'Search demand is not earning expected clicks',
    },
    striking_distance_query: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Strengthen the resolved page for this non-branded query and verify its next GSC window.',
      rule_id: 'striking_distance_query',
      severity: 'medium',
      title: 'Query is within striking distance',
    },
    query_cannibalization: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Consolidate or differentiate the qualifying resolved pages, then verify which page earns the query.',
      rule_id: 'query_cannibalization',
      severity: 'medium',
      title: 'Multiple pages compete for one query',
    },
    property_relative_ctr_gap: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Improve the page title and snippet against its property-relative position cohort, then verify CTR.',
      rule_id: 'property_relative_ctr_gap',
      severity: 'medium',
      title: 'CTR trails comparable property queries',
    },
    emerging_query: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Expand the owned answer while demand is rising and verify the next adjacent GSC window.',
      rule_id: 'emerging_query',
      severity: 'low',
      title: 'Search demand is emerging',
    },
    declining_query: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'traffic',
      remediation:
        'Refresh the owned answer for the declining query and verify recovery in a later GSC window.',
      rule_id: 'declining_query',
      severity: 'medium',
      title: 'Search demand is declining',
    },
    site_contextual_links: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Add the suggested contextual links from this page to the related destination pages, using descriptive anchor text.',
      rule_id: 'site_contextual_links',
      severity: 'low',
      title: 'Add useful contextual links',
    },
    site_link_near_orphan: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Add relevant followed internal links from the suggested source pages to make this page easier to discover and reach.',
      rule_id: 'site_link_near_orphan',
      severity: 'medium',
      title: 'Indexable page has too few followed internal links',
    },
    site_link_weak_authority: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Strengthen this page with relevant followed links from the suggested higher-authority pages.',
      rule_id: 'site_link_weak_authority',
      severity: 'low',
      title: 'Page has weak internal-link authority',
    },
    site_change_potential_regression: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Review the exact before/after evidence, restore the intended page signal, and verify it in a later comparable crawl.',
      rule_id: 'site_change_potential_regression',
      severity: 'high',
      title: 'A crawl-observed page signal regressed',
    },
    site_change_critical_regression: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Review the exact before/after evidence and restore the critical page signal before verifying it in a later comparable crawl.',
      rule_id: 'site_change_critical_regression',
      severity: 'critical',
      title: 'A critical crawl-observed page signal regressed',
    },
    site_change_metadata_inconsistency: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Review the inspected text change and update the modification date only when it accurately describes the published content.',
      rule_id: 'site_change_metadata_inconsistency',
      severity: 'medium',
      title: 'Content change and modification date disagree',
    },
    site_change_cosmetic_refresh: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'site',
      remediation:
        'Confirm whether non-text content changed; otherwise restore an accurate modification date.',
      rule_id: 'site_change_cosmetic_refresh',
      severity: 'low',
      title: 'Modification date moved without inspected text change',
    },
    search_keyword_gap: {
      action_path: 'owned',
      enabled: true,
      opportunity_type: 'topic',
      remediation:
        'Competitors rank for this search and you have no ranking page for it. Improve the page that already covers it or publish one that answers it directly, then confirm in Search Console or a later Search Intelligence analysis. DataForSEO rankings are provider estimates.',
      rule_id: 'search_keyword_gap',
      severity: 'medium',
      title: 'Competitors rank for a search you do not',
    },
    low_share_of_voice_theme: {
      action_path: 'owned',
      enabled: false,
      opportunity_type: 'topic',
      remediation:
        "Increase owned coverage across this theme: publish answer-oriented pages for the theme's highest-value prompts.",
      rule_id: 'low_share_of_voice_theme',
      severity: 'medium',
      title: 'Low share of voice in theme',
    },
    high_traffic_low_visibility: {
      action_path: 'owned',
      enabled: false,
      opportunity_type: 'traffic',
      remediation:
        'Prioritize this high-traffic page for AEO improvements: add quotable answers and structured data where engines already send visitors.',
      rule_id: 'high_traffic_low_visibility',
      severity: 'medium',
      title: 'High-traffic page with low answer-engine visibility',
    },
    earned_page_acquire_listing: {
      action_path: 'earned',
      enabled: true,
      opportunity_type: 'visibility',
      remediation:
        'This page was read and your brand is not on it while a competitor is. Approach the publisher with the facts this brief carries and ask to be included. Once listed, the prompts that cite this page show whether your visibility moved.',
      rule_id: 'earned_page_acquire_listing',
      severity: 'high',
      title: 'Competitors listed on a cited page you are absent from',
    },
  },
  EARNED_RULE_IDS: ['earned_page_acquire_listing'],
  DEMAND_SIGNAL_RULE_IDS: {
    high_impression_low_ctr: 'search_demand_content_gap',
    striking_distance: 'striking_distance_query',
    query_cannibalization: 'query_cannibalization',
    property_relative_ctr_gap: 'property_relative_ctr_gap',
    query_page_relevance: 'property_relative_ctr_gap',
    emerging_query: 'emerging_query',
    declining_query: 'declining_query',
  },
  SITE_ISSUE_TO_OPPORTUNITY_RULE_ID: {
    'aeo.structured_data_present': 'missing_structured_data',
    'aeo.schema_required_valid': 'schema_properties_incomplete',
    'aeo.schema_recommended_present': 'schema_properties_incomplete',
    'aeo.product_evidence_facts': 'schema_properties_incomplete',
    'aeo.listing_item_facts': 'schema_properties_incomplete',
    'aeo.schema_matches_content': 'schema_visible_content_conflict',
    'aeo.answer_first': 'content_structure_incomplete',
    'aeo.question_headings': 'content_structure_incomplete',
    'aeo.heading_hierarchy': 'content_structure_incomplete',
    'aeo.product_answer_facts': 'content_structure_incomplete',
    'aeo.listing_answer_set': 'content_structure_incomplete',
    'aeo.visible_attribution': 'citability_trust_incomplete',
    'aeo.content_date_present': 'citability_trust_incomplete',
    'aeo.offer_freshness_signal': 'citability_trust_incomplete',
    'aeo.source_support_present': 'citability_trust_incomplete',
    'aeo.organization_identity': 'citability_trust_incomplete',
    'aeo.trust_path_present': 'citability_trust_incomplete',
    'aeo.product_brand_identity': 'citability_trust_incomplete',
  },
  SEVERITY_WEIGHTS: {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0.5,
  },
  SEVERITY_WEIGHT_DEFAULT: 1,
  INTENT_VALUE_WEIGHTS: {
    discovery: 1,
    comparison: 1.5,
    purchase: 2,
    service: 1.5,
    local: 1.25,
  },
  INTENT_VALUE_DEFAULT: 1,
  BUYER_STAGE_VALUE_WEIGHTS: {
    awareness: 1,
    consideration: 1.35,
    decision: 1.75,
    implementation: 1.2,
  },
  PROMPT_INTENT_VALUE_WEIGHTS: {
    learn: 1,
    solve: 1.1,
    compare: 1.4,
    recommend: 1.55,
    validate: 1.5,
    buy: 1.75,
    implement: 1.2,
  },
  RECOMMENDATION_STRENGTH_FACTORS: {
    recommended_against: 1.5,
    recommended: 1.35,
    hedged: 1.15,
    mentioned: 1,
    absent: 1,
    not_assessed: 1,
    unavailable: 1,
  },
  // Keyword gaps from published Search Intelligence datasets (owner, 2026-10-09).
  SEARCH_GAP: {
    RULE_ID: 'search_keyword_gap',
    MIN_SEARCH_VOLUME: 50,
    MAX_COMPETITOR_RANK: 10,
    MAX_HITS_PER_REFRESH: 25,
    MAX_DATASET_AGE_DAYS: 90,
    MAX_ROWS_READ: 5000,
    EXCLUDED_INTENTS: ['navigational'],
    // log10(volume) / this, clamped: 100 → 0.5, 10,000 → 1.
    VALUE_LOG_DIVISOR: 4,
    MIN_VALUE_FACTOR: 0.25,
    GAP_FACTOR_BASE: 2,
    GAP_FACTOR_PER_EXTRA_COMPETITOR: 0.5,
    GAP_FACTOR_CAP: 3,
  },
  GAP_COMPETITOR_WEIGHT: 1,
  GAP_COMPETITOR_CAP: 3,
  GAP_OWNED_CITATION_WEIGHT: 1,
  SITE_VALUE_FACTOR: 1,
  SITE_GAP_FACTOR: 1,
  COMMERCE_VALUE_FACTOR: 1,
  COMMERCE_GAP_FACTOR: 1,
  PRIORITY_SCALE: 10,
  PRIORITY_ROUNDING_DECIMALS: 1,
  MIN_PRIORITY_TO_SURFACE: 10,
  RECOMPUTE_MAX_ANALYSES: 5000,
  RECOMPUTE_MAX_ISSUES: 5000,
  LIST_DEFAULT_LIMIT: 50,
  LIST_MAX_LIMIT: 200,
};

export const opportunityDefaults = {
  refresh: {
    task_kind: 'opportunity_refresh',
    evidence_crawl_statuses: ['completed', 'partially_completed', 'cancelled'],
    crawl_status_completed: 'completed',
  },
};
