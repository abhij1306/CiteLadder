/** Earned-actions catalog: deterministic decisions over persisted evidence. */
export const earnedActions = {
  ACTION_PATH_OWNED: 'owned',
  ACTION_PATH_EARNED: 'earned',
  /** Competitors are on a cited page and the brand is not: the one earned decision. */
  RULE_EARNED_PAGE_ACQUIRE: 'earned_page_acquire_listing',
  EARNED_PAGE_TARGET_PREFIX: 'earned-page:',
  /** Your own pages and competitors' own pages can never list you: never read, never acted on. */
  EARNED_EXCLUDED_SOURCE_CLASSES: ['brand_owned', 'competitor_owned'],
  /** Page formats that can take another entry: lists, comparisons, directories, reviews. */
  EARNED_PAGE_INCLUDABLE_FORMATS: [
    'alternative',
    'comparison',
    'directory',
    'listicle',
    'profile',
    'review',
  ],
  EARNED_PAGE_MIN_RECURRENCE: 2,
  EARNED_PAGE_USAGE_FACTOR_MAX: 2,
  EARNED_PAGE_COMPETITOR_FACTOR_MAX: 1.6,
  EARNED_PAGE_COMPETITOR_FACTOR_STEP: 0.2,
  EARNED_PAGE_MAX_PASSAGES: 4,
  EARNED_PAGE_MAX_COMPETITORS: 12,
  /** Also the most prompts a declaration freezes visibility checks for. */
  EARNED_PAGE_MAX_PROMPTS: 12,
  EARNED_PAGE_DETECTOR_MAX_PAGES: 500,
};
