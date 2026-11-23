import type { ActionPriorityBand, ActionStatus } from '@/lib/api/actions';
import { formatCount } from '@/lib/format';
import type {
  ActionGoal,
  ActionGrouping,
  ActionMeasurement,
  ActionTargetKind,
  ActionTreeGroupBy,
} from '@citeladder/contracts/actions';
import type { ContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';

export const ACTION_GOAL_LABEL: Record<ActionGoal, string> = {
  read_site: 'Let AI read your site',
  own_pages: 'Improve your own pages',
  mentions: 'Get mentioned elsewhere',
  wrong_claims: 'Fix wrong claims AI makes about your brand',
};

const GOAL_COUNT_PHRASE: Record<ActionGoal, readonly [string, string]> = {
  read_site: ['fix open', 'fixes open'],
  own_pages: ['action on your pages', 'actions on your pages'],
  mentions: ['placement to win', 'placements to win'],
  wrong_claims: ['claim to correct', 'claims to correct'],
};

export function goalCountPhrase(goal: ActionGoal, count: number): string {
  return `${formatCount(count)} ${goalCountWords(goal, count)}`;
}

export function goalCountWords(goal: ActionGoal, count: number): string {
  const [one, many] = GOAL_COUNT_PHRASE[goal];
  return count === 1 ? one : many;
}

export const ACTION_GOAL_HINT: Record<ActionGoal, string> = {
  read_site: 'Site Health issues that stop AI reading or trusting your pages.',
  own_pages: 'Prompts you miss, pages to create or improve, search queries and internal links.',
  mentions: 'Pages AI cites for your prompts that name competitors and not you.',
  wrong_claims: 'Claims AI answers make about your brand that your own pages contradict.',
};

export const ACTION_GROUPING_LABEL: Record<ActionGrouping, string> = {
  seo: 'SEO',
  aeo: 'AEO',
  content: 'Content',
  prompts: "Prompts you don't appear in",
  create_content: 'Create content',
  improve_pages: 'Improve existing pages',
  search_queries: 'Search queries',
  internal_links: 'Internal links',
  regressed: 'Regressed since the last crawl',
  product_pages: 'Product pages',
  editorial: 'Editorial',
  ugc: 'UGC',
  references: 'Wikis & references',
  other_sources: 'Other',
};

export const IMPACT_LABEL: Record<ActionPriorityBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const OWNERSHIP_LABEL: Record<string, string> = { owned: 'Owned', earned: 'Earned' };

export function treeGroupLabel(groupBy: ActionTreeGroupBy, key: string): string {
  switch (groupBy) {
    case 'goal':
      return isActionGoal(key) ? ACTION_GOAL_LABEL[key] : key;
    case 'what_to_do':
      return approachLabel(key) ?? 'Not diagnosed yet';
    case 'impact':
      return isPriorityBand(key) ? `${IMPACT_LABEL[key]} impact` : 'Not scored';
    case 'ownership':
      return OWNERSHIP_LABEL[key] ?? key;
    case 'topic':
      return key || 'No topic';
    default: {
      const unreachable: never = groupBy;
      return unreachable;
    }
  }
}

const isActionGoal = (key: string): key is ActionGoal => Object.hasOwn(ACTION_GOAL_LABEL, key);
const isPriorityBand = (key: string): key is ActionPriorityBand => Object.hasOwn(IMPACT_LABEL, key);

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: 'New',
  in_progress: 'In progress',
  done: 'Done',
  dismissed: 'Declined',
};

export const ACTION_STATUS_TONE: Record<ActionStatus, 'neutral' | 'info' | 'success'> = {
  open: 'neutral',
  in_progress: 'info',
  done: 'success',
  dismissed: 'neutral',
};

export const ACTION_MEASUREMENT_LABEL: Record<ActionMeasurement, string> = {
  measuring: 'Measuring',
  verified: 'Verified',
};

const TARGET_KIND_LABEL: Record<ActionTargetKind, string> = {
  page: 'Page',
  earned_page: 'Earned page',
  product: 'Product',
  category: 'Category',
  query: 'Search query',
  prompt: 'Prompt',
  planned_page: 'Planned page',
  issue_family: 'Issue across pages',
};

const isTargetKind = (kind: unknown): kind is ActionTargetKind =>
  typeof kind === 'string' && Object.hasOwn(TARGET_KIND_LABEL, kind);

export function targetKindLabel(kind: string | null | undefined): string | null {
  return isTargetKind(kind) ? TARGET_KIND_LABEL[kind] : null;
}

const FAMILY_LABEL: Record<string, string> = {
  ai_visibility: 'Insights',
  sources: 'Sources',
  search_console: 'Search Console',
  search_intelligence: 'Keyword research',
  site_health: 'Site health',
  link_graph: 'Link graph',
  site_changes: 'Site changes',
  commerce: 'Commerce',
  content_optimization: 'Content optimization',
};

export const ACTION_FAMILIES = Object.keys(FAMILY_LABEL);

export function familyLabel(family: string): string | null {
  return FAMILY_LABEL[family] ?? null;
}

const APPROACH_LABEL: Record<string, string> = {
  improve_existing: 'Improve the existing page',
  consolidate: 'Consolidate overlapping pages',
  create_new: 'Create a new page',
  fix_technical: 'Fix a technical issue',
  earned_placement: 'Earn a placement',
  improve_links: 'Improve internal links',
};

export function approachLabel(approach: string | null | undefined): string | null {
  return approach ? (APPROACH_LABEL[approach] ?? null) : null;
}

const MEASUREMENT_LEG_LABEL: Record<string, string> = {
  next_visibility_run: 'The next visibility run on the affected prompts',
  next_search_console_window: 'The next complete Search Console window',
  next_crawl: 'The next crawl of this page',
};

export function measurementLegLabel(leg: string): string | null {
  return MEASUREMENT_LEG_LABEL[leg] ?? null;
}

const CHECK_KIND_LABEL: Record<string, string> = {
  site_rule: 'Website check passes',
  contextual_link: 'Internal link is on the page',
  visibility_metric: 'Prompt score rises',
  traffic_metric: 'Search Console clicks rise',
  keyword_presence: 'You appear for the search',
  owned_url_cited: 'An AI answer cites your page',
  product_metric: 'The product metric clears in later answers',
};

export function checkKindLabel(kind: string): string {
  return CHECK_KIND_LABEL[kind] ?? 'Check';
}

const CHECK_SUBJECT_FALLBACK: Record<string, string> = {
  owned_url_cited: 'A new page of yours, not one already cited for these prompts',
};

export function checkSubject(check: { kind: string; subject: string | null }): string | null {
  return check.subject ?? CHECK_SUBJECT_FALLBACK[check.kind] ?? null;
}

const CHECK_KIND_NOTE: Record<string, string> = {
  owned_url_cited:
    'A citation shows the page was cited, not which version of it the AI engine read.',
};

export function checkKindNote(kind: string): string | null {
  return CHECK_KIND_NOTE[kind] ?? null;
}

export function contentGapCheckPreview(evidence: ContentGapEvidence): string {
  const page =
    'planned_page_key' in evidence
      ? 'a new page of yours, one not already cited for them'
      : evidence.url;
  return `${checkKindLabel('owned_url_cited')}: checks whether an AI answer to the angle's prompts cites ${page}.`;
}

const CHECK_STATE_LABEL: Record<'waiting' | 'met' | 'unmet' | 'unavailable', string> = {
  waiting: 'Waiting',
  met: 'Met',
  unmet: 'Not met',
  unavailable: 'Not measurable yet',
};

const CHECK_REASON: Record<string, string> = {
  page_not_analyzed: 'The page was not read in that crawl. Run a crawl that includes it.',
  rule_not_evaluated: 'The check does not apply to the page as it was read.',
  no_resolved_target: 'The page could not be matched to a crawled URL.',
  link_capture_incomplete: "The crawl did not capture the page's links fully.",
  not_prompt_scoped: 'Declared against the project score, which cannot verify one Action.',
  no_metric_snapshot: 'That run produced no scores.',
  prompt_not_in_run: 'The prompt was not part of that run.',
  prompt_score_unavailable: 'The prompt has no score in that run.',
  no_frozen_baseline: 'There was no reading before the change to compare with.',
  not_page_scoped: 'Declared against site-wide clicks, which cannot verify one Action.',
  unsupported_direction: 'The check names a change CiteLadder cannot compare.',
  no_traffic_snapshot: 'The Search Console window is no longer stored.',
  window_overlaps_declaration: 'That window includes the go-live day or earlier.',
  no_search_console_row: 'Search Console reported no row for this page or query.',
  not_ranking_yet: 'A later Keyword research analysis does not show you ranking yet.',
  still_missing: 'A later Keyword research analysis still lists this as a gap.',
  prompts_not_in_run: 'None of these prompts was part of that run.',
  no_answers: 'That run has no answers to these prompts.',
  too_few_samples:
    'The answers since go-live are too few to read this metric yet. Later runs add to them.',
  quotes_in_other_currencies:
    'The answers since go-live quote this product only in other currencies, which are not converted. Later runs may quote the catalog currency.',
  no_answers_after_go_live: 'No matched answer has completed since the go-live date yet.',
  no_catalog_price: 'The product has no catalog price to compare quoted prices with.',
  product_not_in_catalog: 'The product is no longer an active catalog product.',
  unsupported_window: 'The check names a window the Products read no longer offers.',
  provider_serp_predates_change:
    'DataForSEO last checked this search before the go-live date. A later analysis can answer it.',
};

export function checkReasonLabel(reason: string | null): string | null {
  return reason ? (CHECK_REASON[reason] ?? null) : null;
}

export function checkStateLabel(check: {
  state: 'waiting' | 'met' | 'unmet' | 'unavailable';
}): string {
  return CHECK_STATE_LABEL[check.state];
}

export const IMPLEMENTATION_STATE_LABEL: Record<
  'declared' | 'observed' | 'verified' | 'contradicted',
  string
> = {
  declared: 'Declared. Waiting for the first reading.',
  observed: 'Measuring. Some checks are still waiting.',
  verified: 'Every check is met.',
  contradicted: 'At least one check is not met.',
};

const MOVEMENT_LEG_LABEL: Record<string, string> = {
  visibility: 'Visibility',
  ai_referral_traffic: 'AI referral traffic',
  branded_search_demand: 'Branded search demand',
};

export function movementLegLabel(leg: string): string | null {
  return MOVEMENT_LEG_LABEL[leg] ?? null;
}

const MOVEMENT_STATE_LABEL: Record<string, string> = {
  available: 'compared',
  observed_zero: 'compared (zero after)',
  unavailable: 'not available',
  non_comparable: 'not comparable',
  not_run: 'no reading yet',
};

export function movementStateLabel(state: string): string {
  return MOVEMENT_STATE_LABEL[state] ?? 'state not recognized';
}

const SKILL_GROUP_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  demand: 'Demand',
  owned_site: 'Your site',
  visibility: 'AI visibility',
  content: 'Content',
};

export function skillGroupLabel(group: string): string {
  return SKILL_GROUP_LABEL[group] ?? 'Other';
}

const RUN_ERROR_COPY: Record<string, string> = {
  stopped_at_limit:
    'The agent stopped at its step limit before finishing. Nothing was saved; ask again with a narrower request.',
  access_revoked: 'You no longer have permission to run the agent in this workspace.',
  skills_changed: 'The agent was updated after this request was queued. Send it again.',
  output_conflict:
    'The output changed while the agent was working, so its revision was not saved. Ask again to revise the latest version.',
  model_unavailable:
    "No Agent model is configured. Set DEFAULT_AGENT_* in the server's .env and restart, then send it again.",
  provider_error: 'The model provider returned an error. Try again.',
  interrupted: 'The page closed before the agent finished. Nothing was saved; send it again.',
  turn_timeout:
    'This turn ran past its time limit. Nothing was saved; narrow the request and try again.',
  tool_failed: 'A data read failed. Try again.',
  model_refused:
    'The model declined to answer this request. Nothing was saved; rephrase it or ask about one part at a time.',
  output_too_long:
    'The model ran out of room to finish, even after a shorter second attempt. Nothing was saved; ask for one part at a time.',
  context_too_long:
    'This chat is longer than the model can read at once. Nothing was saved; start a new chat to continue.',
  incompatible_budget:
    'The agent policy changed incompatibly after admission. Send this request again.',
  context_size_limit:
    'The selected context is too large for this turn. Remove a context reference or use a smaller upstream brief and send again.',
};

const SUGGESTION_CATEGORY_LABEL: Record<string, string> = {
  correctness: 'Correctness',
  clarity: 'Clarity',
  ai_answers: 'AI answers',
  proof: 'Proof',
  search_guidelines: 'Search guidelines',
  natural_voice: 'Natural voice',
  coverage: 'Coverage',
};

export function suggestionCategoryLabel(category: string): string {
  return SUGGESTION_CATEGORY_LABEL[category] ?? 'Suggestion';
}

const SUGGESTION_STRENGTH_COPY = {
  requirement: { badge: 'Search policy', lead: 'Required by' },
  recommendation: { badge: null, lead: 'Optional. Recommended in' },
  heuristic: {
    badge: 'Heuristic',
    lead: 'Optional. A heuristic, not search engine guidance, from',
  },
} as const satisfies Record<
  'requirement' | 'recommendation' | 'heuristic',
  { badge: string | null; lead: string }
>;

export function suggestionStrengthCopy(strength: keyof typeof SUGGESTION_STRENGTH_COPY) {
  return SUGGESTION_STRENGTH_COPY[strength];
}

const SUGGESTION_STALE_COPY: Record<string, string> = {
  span_changed: 'The text it would change was edited since it was suggested.',
  field_changed: 'That SEO field was edited since it was suggested.',
  dependency_changed: 'The section it read was edited since it was suggested.',
  replaced: 'A newer suggestion replaced it.',
};

export function suggestionStaleCopy(reason: string | null): string {
  const why = reason ? SUGGESTION_STALE_COPY[reason] : undefined;
  return `This suggestion no longer fits the page. ${why ?? 'The page changed since it was suggested.'}`;
}

export const SUGGESTION_CONFLICT_COPY =
  'This suggestion can’t be changed now. Reload the page and try again.';

export const PAGE_CHANGED_COPY =
  'The page changed since you opened it. The latest version is shown now; check it and try again.';

export function runErrorCopy(code: string): string {
  return RUN_ERROR_COPY[code] ?? 'The agent could not finish this request. Try again.';
}
