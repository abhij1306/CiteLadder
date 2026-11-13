/**
 * The content rule catalog (docs/plans/content-rules-engine.md, "The rule
 * catalog"; CO13): the rules a page document's suggestions apply, each with
 * its category, layer, check, source and strength, and the evidence it needs.
 * Seeded from the plan's appendix research catalog (each rule's `ref`).
 *
 * Two layers live here. `site_health` rules (L0) are owned by Site Health's
 * evaluators and listed only so their findings carry a category, source and
 * strength, and so the model pass never raises or re-judges them; it may only
 * write the text for one of their findings already on the page. `model` rules
 * (L4) are the ones the model pass judges. The deterministic L1–L3 rules are
 * not here until their linters run. The catalog's version is a fingerprint of
 * this file's content (`page-documents/content-rules.ts`).
 */

/** User-facing categories, in display order; every suggestion has one. */
const CONTENT_RULE_CATEGORIES = [
  'correctness',
  'clarity',
  'ai_answers',
  'proof',
  'search_guidelines',
  'natural_voice',
  'coverage',
] as const;

/**
 * What a rule needs before it may run. `fetched_page`: the page document and
 * its fetch. `page_kind`: the fetch knows the page's Site Health kind (needed
 * by rules limited to some page types). `page_prompts`: the prompts the page
 * should be cited for, from the Action's content-gap evidence or the prompts
 * chosen for the chat. The rest are never available to the model pass yet.
 */
const CONTENT_RULE_EVIDENCE = [
  'fetched_page',
  'page_kind',
  'page_prompts',
  'crawl_history',
  'site_pages',
  'cited_page_text',
  'link_checks',
  'external_retrieval',
] as const;

/** Where each rule's guidance comes from. */
const CONTENT_RULE_SOURCES = {
  g_helpful: {
    label: 'Google Search Central: creating helpful content',
    url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  },
  g_spam: {
    label: 'Google Search Central: spam policies',
    url: 'https://developers.google.com/search/docs/essentials/spam-policies',
  },
  g_ai_features: {
    label: 'Google Search Central: AI features and your website',
    url: 'https://developers.google.com/search/docs/appearance/ai-features',
  },
  g_title: {
    label: 'Google Search Central: title links',
    url: 'https://developers.google.com/search/docs/appearance/title-link',
  },
  g_snippet: {
    label: 'Google Search Central: snippets and meta descriptions',
    url: 'https://developers.google.com/search/docs/appearance/snippet',
  },
  g_structured_data: {
    label: 'Google Search Central: structured data policies',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
  },
  g_images: {
    label: 'Google Search Central: images',
    url: 'https://developers.google.com/search/docs/appearance/google-images',
  },
  g_links: {
    label: 'Google Search Central: crawlable links',
    url: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  },
  g_starter: {
    label: 'Google Search Central: SEO starter guide',
    url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
  },
  g_dates: {
    label: 'Google Search Central: publication dates',
    url: 'https://developers.google.com/search/docs/appearance/publication-dates',
  },
  g_canonical: {
    label: 'Google Search Central: duplicate URLs',
    url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  },
  g_raters: {
    label: 'Google search quality rater guidelines',
    url: 'https://services.google.com/fh/files/misc/hsw-sqrg.pdf',
  },
  ms_ai_answers: {
    label: 'Microsoft Advertising: content for AI search answers',
    url: 'https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers',
  },
  openai_crawlers: {
    label: 'OpenAI: crawlers',
    url: 'https://developers.openai.com/api/docs/bots',
  },
  geo: {
    label: 'Aggarwal et al. 2024, GEO (research)',
    url: 'https://arxiv.org/abs/2311.09735',
  },
  autogeo: {
    label: 'Wu et al. 2026, AutoGEO (research)',
    url: 'https://arxiv.org/abs/2510.11438',
  },
  wiki_ai_writing: {
    label: 'Wikipedia: signs of AI writing',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing',
  },
} as const satisfies Record<string, { label: string; url: string }>;

type Category = (typeof CONTENT_RULE_CATEGORIES)[number];
type Evidence = (typeof CONTENT_RULE_EVIDENCE)[number];
type SourceKey = keyof typeof CONTENT_RULE_SOURCES;
/**
 * `requirement`: a search-engine policy. `recommendation`: guidance that
 * suggests rather than requires. `heuristic`: a tool convention or contested
 * evidence, labelled as such. Recommendations and heuristics are phrased as options.
 */
type Strength = 'requirement' | 'recommendation' | 'heuristic';

/** A Site Health rule (L0); its id is Site Health's rule id. */
type SiteHealthRule = {
  id: string;
  ref: string;
  layer: 'L0';
  check: 'deterministic';
  category: Category;
  source: SourceKey;
  strength: Strength;
};
/** A rule the model pass (L4) judges. `page_types` limits it to Site Health page kinds. */
type ModelRule = {
  id: string;
  ref: string;
  layer: 'L4';
  check: 'model' | 'hybrid';
  category: Category;
  severity: 'high' | 'medium' | 'low';
  page_types: 'any' | readonly string[];
  requires: readonly Evidence[];
  source: SourceKey;
  strength: Strength;
  /** What the rule checks, as the model reads it. */
  checks: string;
  /** Rule-specific phrasing, beyond its strength's. */
  guidance?: string;
  thresholds?: Readonly<Record<string, number>>;
};
export type ContentRule = SiteHealthRule | ModelRule;

const PAGE: readonly Evidence[] = ['fetched_page'];
const COMPARISONS = ['comparison', 'alternative', 'listicle', 'case_study_review'];
const site = (
  id: string,
  ref: string,
  category: Category,
  source: SourceKey,
  strength: Strength = 'recommendation',
): SiteHealthRule => ({ id, ref, layer: 'L0', check: 'deterministic', category, source, strength });

type ModelOverrides = Partial<
  Pick<
    ModelRule,
    'check' | 'severity' | 'page_types' | 'requires' | 'strength' | 'guidance' | 'thresholds'
  >
>;
/**
 * A model rule (L4): a page rule judged by the model alone, of medium severity
 * and recommendation strength, unless `overrides` says otherwise.
 */
const model = (
  id: string,
  ref: string,
  category: Category,
  source: SourceKey,
  checks: string,
  overrides: ModelOverrides = {},
): ModelRule => ({
  id,
  ref,
  layer: 'L4',
  check: 'model',
  category,
  severity: 'medium',
  page_types: 'any',
  requires: PAGE,
  source,
  strength: 'recommendation',
  checks,
  ...overrides,
});

// Shared override sets: code finds candidates and the model judges (`hybrid`),
// and the AI-writing tells, which are clarity heuristics flagged as clusters.
const HYBRID = { check: 'hybrid' } as const;
const HYBRID_LOW = { check: 'hybrid', severity: 'low' } as const;
const HYBRID_HIGH = { check: 'hybrid', severity: 'high' } as const;
const SPAM = { ...HYBRID_HIGH, strength: 'requirement' } as const;
const HEURISTIC = { ...HYBRID_LOW, strength: 'heuristic' } as const;
const CLARITY_FIX = 'A clarity fix, never a verdict on who wrote it.';
const VOICE_CLUSTER = { ...HEURISTIC, guidance: CLARITY_FIX } as const;

/**
 * Appendix rules left out, and why: every deterministic one (A8, A13, B8, C3–C8,
 * C11, C14, C15, C19, D1–D7, E1, E2, E6, E9, E10, F1, F3, F4) until the L1–L3
 * linters run, except those Site Health already checks (L0 below); A6 (whether
 * AI was used is not knowable from the page, and the engine gives no authorship
 * verdicts); C16 (link `rel` attributes are not in the Markdown page document).
 */
const RULES: readonly ContentRule[] = [
  // L0: Site Health owns these. The model pass never raises them.
  site('technical.title_present', 'C1', 'search_guidelines', 'g_title'),
  site('technical.meta_description_present', 'C9', 'search_guidelines', 'g_snippet'),
  site('technical.canonical_present', 'C20', 'search_guidelines', 'g_canonical'),
  site('technical.indexable', 'B1', 'ai_answers', 'g_ai_features'),
  site('search.snippet_access', 'B1', 'ai_answers', 'g_ai_features'),
  site('search.crawler_access', 'B2', 'ai_answers', 'g_ai_features'),
  site('technical.ai_crawler_access', 'B2', 'ai_answers', 'openai_crawlers'),
  site('aeo.server_rendered_content', 'B3', 'ai_answers', 'g_ai_features'),
  site('aeo.answer_first', 'B4', 'ai_answers', 'ms_ai_answers'),
  site('aeo.question_headings', 'B5', 'ai_answers', 'ms_ai_answers'),
  site('aeo.source_support_present', 'B11', 'proof', 'g_helpful'),
  site(
    'aeo.schema_matches_content',
    'B18',
    'search_guidelines',
    'g_structured_data',
    'requirement',
  ),
  site('architecture.orphan_pages', 'B19', 'ai_answers', 'g_links'),
  site('web.accessibility_image_alt', 'C13', 'search_guidelines', 'g_images'),
  site('aeo.schema_required_valid', 'C17', 'search_guidelines', 'g_structured_data', 'requirement'),
  site('aeo.content_date_present', 'C19', 'proof', 'g_dates'),
  site('aeo.visible_attribution', 'A5', 'search_guidelines', 'g_helpful'),
  site('aeo.trust_path_present', 'G3', 'search_guidelines', 'g_raters'),

  // L4: the model pass judges these.
  model(
    'search_guidelines.original_value',
    'A1',
    'search_guidelines',
    'g_helpful',
    'The page adds original information or analysis beyond the pages it draws on.',
    { requires: ['fetched_page', 'cited_page_text'] },
  ),
  model(
    'search_guidelines.coverage_depth',
    'A2',
    'search_guidelines',
    'g_helpful',
    'The page covers its topic as substantially as the pages cited for it.',
    { ...HYBRID, requires: ['fetched_page', 'cited_page_text'] },
  ),
  model(
    'search_guidelines.accurate_headings',
    'A3',
    'search_guidelines',
    'g_helpful',
    'The title and headings describe the content without exaggerating or shocking.',
  ),
  model(
    'search_guidelines.first_hand_experience',
    'A4',
    'search_guidelines',
    'g_helpful',
    'The page shows first-hand experience or deep knowledge where the topic calls for it.',
    {
      severity: 'low',
      guidance: 'Ask the person for the experience in needs_input; never invent it.',
    },
  ),
  model(
    'search_guidelines.people_first',
    'A7',
    'search_guidelines',
    'g_helpful',
    'The page serves a reader with a purpose rather than existing to rank for a query.',
  ),
  model(
    'search_guidelines.no_padding',
    'A9',
    'search_guidelines',
    'g_helpful',
    'Passages that pad the page toward a length without adding anything.',
    { guidance: 'Suggest cutting or tightening; never suggest a target word count.' },
  ),
  model(
    'search_guidelines.ymyl_standard',
    'A10',
    'search_guidelines',
    'g_raters',
    'On a health, finance, legal or safety topic, advice is backed by expertise and sources.',
    { ...HYBRID_HIGH, guidance: 'Ask for the expert, reviewer or source in needs_input.' },
  ),
  model(
    'search_guidelines.no_scaled_duplicates',
    'A11',
    'search_guidelines',
    'g_spam',
    'The page is not a templated near-duplicate of the site’s other pages.',
    { ...SPAM, requires: ['fetched_page', 'site_pages'] },
  ),
  model(
    'search_guidelines.no_keyword_stuffing',
    'A12',
    'search_guidelines',
    'g_spam',
    'Terms repeated unnaturally, or lists of keywords, cities or phrases out of context.',
    { ...SPAM, guidance: 'Never suggest a keyword density or adding a keyword.' },
  ),
  model(
    'search_guidelines.no_thin_affiliate',
    'A14',
    'search_guidelines',
    'g_spam',
    'Affiliate or product copy that adds nothing beyond what the merchant publishes.',
    SPAM,
  ),
  model(
    'search_guidelines.factual_accuracy',
    'A15',
    'search_guidelines',
    'g_helpful',
    'The page holds no easily verified factual errors.',
    { severity: 'high', requires: ['fetched_page', 'external_retrieval'] },
  ),
  model(
    'ai_answers.self_contained_passages',
    'B6',
    'ai_answers',
    'ms_ai_answers',
    'A section start leans on "this", "it" or "the above" from the section before, so the passage cannot stand alone.',
    HYBRID,
  ),
  model(
    'ai_answers.lists_and_tables',
    'B7',
    'ai_answers',
    'ms_ai_answers',
    'Steps or comparisons written as prose that a list or table would make clearer.',
    HYBRID_LOW,
  ),
  model(
    'proof.specific_statistics',
    'B9',
    'proof',
    'geo',
    'A vague claim ("many", "significantly") where a specific figure would carry it.',
    {
      ...HEURISTIC,
      severity: 'medium',
      guidance: 'Ask for the figure in needs_input unless the page or business facts hold it.',
    },
  ),
  model(
    'proof.attributed_quotes',
    'B10',
    'proof',
    'geo',
    'A point an attributed quote from a relevant authority would support.',
    {
      ...HEURISTIC,
      guidance: 'Ask for the quote and who said it in needs_input; never write one.',
    },
  ),
  model(
    'clarity.fluent_prose',
    'B12',
    'clarity',
    'geo',
    'A sentence that is hard to follow and reads more clearly said another way.',
    {
      severity: 'low',
      strength: 'heuristic',
      guidance: 'Keep the meaning and the person’s voice; minimal edits only.',
    },
  ),
  model(
    'ai_answers.precise_terms',
    'B13',
    'ai_answers',
    'autogeo',
    'A vague word where the domain has a precise term, or a term used without definition.',
    { severity: 'low' },
  ),
  model(
    'proof.anchored_superlatives',
    'B14',
    'proof',
    'ms_ai_answers',
    'A superlative ("best", "leading", "#1") with no fact on the page supporting it.',
    {
      ...HYBRID,
      guidance: 'Suggest the plain claim, or ask for the supporting fact in needs_input.',
    },
  ),
  model(
    'search_guidelines.title_h1_meta_consistent',
    'B15',
    'search_guidelines',
    'g_title',
    'The title, the H1 and the meta description describe the same page.',
    { ...HYBRID, guidance: 'Name title and meta_description in depends_on.' },
  ),
  model(
    'ai_answers.balanced_comparison',
    'B16',
    'ai_answers',
    'autogeo',
    'A comparison gives each option’s pros and cons in a neutral tone.',
    { page_types: COMPARISONS, requires: ['fetched_page', 'page_kind'] },
  ),
  model(
    'proof.dated_facts',
    'B17',
    'proof',
    'g_dates',
    'A time-sensitive fact (a price, a figure, "currently", "this year") without its date.',
    {
      ...HYBRID,
      guidance:
        'Ask for the date in needs_input; never suggest changing a date the content did not change.',
    },
  ),
  model(
    'search_guidelines.descriptive_title',
    'C2',
    'search_guidelines',
    'g_title',
    'The title says what the page is about, not "Home" or a bare brand name.',
    HYBRID,
  ),
  model(
    'search_guidelines.meta_description_summary',
    'C9',
    'search_guidelines',
    'g_snippet',
    'An existing meta description summarizes this page.',
    {
      ...HYBRID_LOW,
      guidance:
        'A missing meta description is Site Health’s finding: write its text under technical.meta_description_present.',
    },
  ),
  model(
    'search_guidelines.meta_description_not_keywords',
    'C10',
    'search_guidelines',
    'g_snippet',
    'The meta description is a sentence about the page, not a list of keywords.',
    HYBRID_LOW,
  ),
  model(
    'search_guidelines.descriptive_headings',
    'C12',
    'search_guidelines',
    'g_starter',
    'A heading that does not describe the section under it.',
    { ...HYBRID_LOW, guidance: 'Heading order and a single H1 are not rules.' },
  ),
  model(
    'search_guidelines.truthful_markup',
    'C18',
    'search_guidelines',
    'g_structured_data',
    'JSON-LD that claims what the page does not show, such as reviews or ratings.',
    SPAM,
  ),
  model(
    'clarity.one_claim_per_sentence',
    'D8',
    'clarity',
    'ms_ai_answers',
    'A sentence that packs several claims an answer would quote separately.',
    HEURISTIC,
  ),
  model(
    'natural_voice.negative_parallelism',
    'E3',
    'natural_voice',
    'wiki_ai_writing',
    'Repeated "not just X, but Y" constructions.',
    { ...VOICE_CLUSTER, thresholds: { min_occurrences: 3 } },
  ),
  model(
    'natural_voice.rule_of_three',
    'E4',
    'natural_voice',
    'wiki_ai_writing',
    'Lists of three used out of habit rather than because there are three things.',
    { ...VOICE_CLUSTER, thresholds: { min_occurrences: 3 } },
  ),
  model(
    'natural_voice.trailing_significance',
    'E5',
    'natural_voice',
    'wiki_ai_writing',
    'Sentences ending in an "-ing" clause that asserts significance ("highlighting its importance").',
    { ...VOICE_CLUSTER, thresholds: { min_occurrences: 2 } },
  ),
  model(
    'natural_voice.puffery',
    'E7',
    'natural_voice',
    'wiki_ai_writing',
    'Inflated significance ("a testament to", "plays a pivotal role").',
    { ...HEURISTIC, guidance: 'Suggest the plain statement.' },
  ),
  model(
    'proof.vague_attribution',
    'E8',
    'proof',
    'wiki_ai_writing',
    'A claim credited to unnamed authorities ("experts say", "studies show").',
    {
      ...HEURISTIC,
      severity: 'medium',
      guidance: 'Ask who in needs_input, or suggest stating it as the page’s own claim.',
    },
  ),
  model(
    'natural_voice.formulaic_sections',
    'E11',
    'natural_voice',
    'wiki_ai_writing',
    'Formulaic sections, such as a conclusion that only repeats the page.',
    { severity: 'low', strength: 'heuristic' },
  ),
  model(
    'correctness.grammar',
    'F2',
    'correctness',
    'g_helpful',
    'A clear spelling or grammar error.',
    {
      ...HYBRID,
      guidance:
        'Only unambiguous errors, as minimal edits; leave brand names, product names and deliberate style alone.',
    },
  ),
  model(
    'proof.sourced_statistics',
    'G1',
    'proof',
    'g_helpful',
    'A statistic without its source or date.',
    { ...HYBRID, guidance: 'Ask for the source in needs_input; never name one yourself.' },
  ),
  model(
    'proof.supporting_links',
    'G2',
    'proof',
    'wiki_ai_writing',
    'Cited links resolve and support the claim they are cited for.',
    { ...HYBRID, requires: ['fetched_page', 'link_checks'] },
  ),
  model(
    'search_guidelines.ymyl_credentials',
    'G4',
    'search_guidelines',
    'g_raters',
    'On a health, finance, legal or safety topic, the author’s or reviewer’s credentials.',
    { ...HYBRID, guidance: 'Ask for them in needs_input.' },
  ),
  model(
    'search_guidelines.truthful_identity_markup',
    'G5',
    'search_guidelines',
    'g_structured_data',
    'Organization or Person JSON-LD that contradicts the business facts.',
    { severity: 'high', strength: 'requirement' },
  ),
  model(
    'coverage.cited_angles',
    'CO',
    'coverage',
    'g_helpful',
    'What answers to the page’s prompts cover that the page lacks, when it fits the page’s purpose.',
    {
      severity: 'high',
      requires: ['fetched_page', 'page_prompts'],
      guidance: 'Never copy the cited pages’ wording; ask for facts the page lacks in needs_input.',
    },
  ),
];

export const contentRules = {
  categories: CONTENT_RULE_CATEGORIES,
  evidence: CONTENT_RULE_EVIDENCE,
  sources: CONTENT_RULE_SOURCES,
  /** How a suggestion from each strength is worded. */
  phrasing: {
    requirement: 'State it plainly: the page breaks a search-engine policy.',
    recommendation: 'Phrase it as an option grounded in published guidance, never as a must.',
    heuristic:
      'Phrase it as an option and say it is a heuristic: a tool convention or contested evidence.',
  },
  /** Said with every rule list: what a suggestion may never do. */
  limits:
    'Never promise a ranking or citation gain and never quote an uplift. A fact, figure, source, quote or credential the page, the business facts or the person do not give is asked for in needs_input, never written. A missing source is not a false claim.',
  rules: RULES,
} as const;
