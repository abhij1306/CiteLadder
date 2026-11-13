/**
 * The one place an Agent or Action token becomes something a reader reads.
 *
 * An unmapped token renders as nothing (or a neutral fallback where a label is
 * structurally required), never as the raw backend identifier.
 */
import type { PriorityValue } from '@/components/ui/badge';
import type { ActionGroup, ActionPriorityBand, ActionStatus } from '@/lib/api/actions';
import type { ActionTargetKind } from '@citeladder/contracts/actions';
import type { ContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';

/** The band the server put an Action's priority score in; the score itself only ranks. */
export const PRIORITY_BAND_LABEL: Record<ActionPriorityBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** A band as the priority badge's value (its tint and bar glyph). */
export const PRIORITY_BAND_VALUE: Record<ActionPriorityBand, PriorityValue> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** The Actions list's groups, in the order the list shows them (AS2). */
export const ACTION_GROUP_LABEL: Record<ActionGroup, string> = {
  fix_site: 'Fix how AI reads your site',
  own_pages: 'Improve your own pages',
  earned: 'Get mentioned elsewhere',
  products: 'Improve your products',
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  implemented: 'Implemented',
  measuring: 'Measuring',
  done: 'Done',
  dismissed: 'Dismissed',
};

/** Badge tone per status; meaning is always carried by the label too. */
export const ACTION_STATUS_TONE: Record<ActionStatus, 'neutral' | 'info' | 'success' | 'warning'> =
  {
    open: 'neutral',
    in_progress: 'info',
    implemented: 'info',
    measuring: 'warning',
    done: 'success',
    dismissed: 'neutral',
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

// Keyed by the contract's kinds, so a kind without a label fails the type check;
// the contract is imported as a type only, keeping its schemas out of the eager bundle.
const isTargetKind = (kind: unknown): kind is ActionTargetKind =>
  typeof kind === 'string' && Object.hasOwn(TARGET_KIND_LABEL, kind);

export const ACTION_TARGET_KINDS = Object.keys(TARGET_KIND_LABEL).filter(isTargetKind);

export function targetKindLabel(kind: string | null | undefined): string | null {
  return isTargetKind(kind) ? TARGET_KIND_LABEL[kind] : null;
}

const FAMILY_LABEL: Record<string, string> = {
  ai_visibility: 'AI Visibility',
  sources: 'Sources',
  search_console: 'Search Console',
  search_intelligence: 'Keyword Research',
  site_health: 'Site Health',
  link_graph: 'Link graph',
  site_changes: 'Site changes',
  commerce: 'Commerce',
  content_optimization: 'Content optimization',
};

/** Every Action Source (evidence family) a reader can filter by. */
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

/** Every Action type (approach) a reader can filter by. */
export const ACTION_APPROACHES = Object.keys(APPROACH_LABEL);

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

/** What one expected check asks, before its subject. */
const CHECK_KIND_LABEL: Record<string, string> = {
  site_rule: 'Site Health check passes',
  contextual_link: 'Internal link is on the page',
  visibility_metric: 'Prompt score rises',
  traffic_metric: 'Search Console clicks rise',
  keyword_presence: 'You appear for the search',
  owned_url_cited: 'An AI answer cites your page',
  product_metric: 'The product metric clears in later answers',
  issue_family: 'Every affected page passes the Site Health check',
};

export function checkKindLabel(kind: string): string {
  return CHECK_KIND_LABEL[kind] ?? 'Check';
}

/** What a check names when the server names nothing: a new page has no URL until it is cited. */
const CHECK_SUBJECT_FALLBACK: Record<string, string> = {
  owned_url_cited: 'A new page of yours, not one already cited for these prompts',
};

export function checkSubject(check: { kind: string; subject: string | null }): string | null {
  return check.subject ?? CHECK_SUBJECT_FALLBACK[check.kind] ?? null;
}

/** What a check's reading cannot show, said beside it. */
const CHECK_KIND_NOTE: Record<string, string> = {
  owned_url_cited:
    'A citation shows the page was cited, not which version of it the AI engine read.',
};

export function checkKindNote(kind: string): string | null {
  return CHECK_KIND_NOTE[kind] ?? null;
}

/**
 * What declaring a content-gap finding will check, before the user commits:
 * the improved page's address, or a new page of theirs.
 */
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

/** Why a reading could not answer a check, and what changes that. */
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
  not_ranking_yet: 'A later Keyword Research analysis does not show you ranking yet.',
  still_missing: 'A later Keyword Research analysis still lists this as a gap.',
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
  partially_resolved: 'Some affected pages now pass; the pages listed still fail.',
  still_failing: 'No affected page the crawl read passes yet.',
  non_comparable_crawl:
    'That crawl used a different analyzer or rule set than the one that found the issue, so it cannot be compared.',
  baseline_crawl_unavailable: 'The crawl that found the issue is no longer stored.',
  cohort_not_analyzed:
    'That crawl did not read the affected pages after go-live. Run a crawl that includes them.',
  cohort_partly_analyzed:
    'The affected pages that crawl read pass, but it did not read them all. Run a crawl that includes the rest.',
  cohort_sampled:
    'Every checked page passes or no longer applies, but the issue was on more pages than one check covers, so it cannot be verified on all of them.',
};

export function checkReasonLabel(reason: string | null): string | null {
  return reason ? (CHECK_REASON[reason] ?? null) : null;
}

const FAMILY_UNMET_LABEL: Record<string, string> = {
  partially_resolved: 'Partially resolved',
  still_failing: 'Still failing',
};

/**
 * A check's state as a reader is told it. An issue-family check reads its
 * whole cohort, so it is verified, partially resolved, still failing or
 * inconclusive; an unmet reading with an unknown reason, and every other
 * check, keep `CHECK_STATE_LABEL`.
 */
export function checkStateLabel(check: {
  kind: string;
  state: 'waiting' | 'met' | 'unmet' | 'unavailable';
  reason: string | null;
}): string {
  if (check.kind !== 'issue_family') return CHECK_STATE_LABEL[check.state];
  if (check.state === 'met') return 'Verified';
  if (check.state === 'unavailable') return 'Inconclusive';
  const subtype = check.state === 'unmet' && check.reason ? FAMILY_UNMET_LABEL[check.reason] : null;
  return subtype ?? CHECK_STATE_LABEL[check.state];
}

/** The declaration's overall reading, never the raw observation kind. */
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
  not_run: 'not measured yet',
};

export function movementStateLabel(state: string): string {
  return MOVEMENT_STATE_LABEL[state] ?? 'state not recognized';
}

const SKILL_GROUP_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  demand: 'Search demand',
  owned_site: 'Your site',
  visibility: 'AI visibility',
  content: 'Content',
};

export function skillGroupLabel(group: string): string {
  return SKILL_GROUP_LABEL[group] ?? 'Other';
}

/**
 * Terminal run failures, in the reader's terms. Each names what happened and
 * what the reader can do; none claims an output was saved.
 */
const RUN_ERROR_COPY: Record<string, string> = {
  stopped_at_limit:
    'The agent stopped at its step limit before finishing. Nothing was saved; ask again with a narrower request.',
  access_revoked: 'You no longer have permission to run the agent in this workspace.',
  model_changed: 'The agent model changed after this request was queued. Send it again.',
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

type RunStep = { status: string; tool: string | null };

const READ_OUTCOME_SUFFIX: Record<string, string> = {
  completed: '',
  unavailable: ' · no data yet',
  refused: ' · not allowed',
  failed: ' · failed',
};

/** One live step of an active run, in the reader's terms. */
export function runStepLabel(step: RunStep): string {
  if (step.tool) {
    const read = step.tool.replaceAll('_', ' ');
    const suffix = READ_OUTCOME_SUFFIX[step.status] ?? ' · status unknown';
    return `${read.charAt(0).toUpperCase()}${read.slice(1)}${suffix}`;
  }
  if (step.status === 'working') return 'Deciding the next step…';
  if (step.status === 'processing') return 'Processing the next step…';
  if (step.status === 'reasoned') return 'Planned the next step';
  if (step.status === 'failed') return 'Step failed';
  if (step.status === 'interrupted') return 'Earlier attempt interrupted';
  return 'Step status unknown';
}

/** The Agent's own tools; every other tool is a data read. */
const BUILTIN_TOOL_LABEL: Record<string, Record<'started' | 'completed' | 'refused', string>> = {
  load_skill: {
    started: 'Loading the method…',
    completed: 'Loaded the method',
    refused: 'Method not loaded',
  },
  save_document: {
    started: 'Saving the document…',
    completed: 'Saved the document',
    refused: 'Document not saved',
  },
  edit_document: {
    started: 'Editing the document…',
    completed: 'Edited the document',
    refused: 'Document not edited',
  },
  suggest_edits: {
    started: 'Suggesting changes…',
    completed: 'Suggested changes',
    refused: 'Changes not suggested',
  },
  // Provider-hosted; its results are outside pages, not CiteLadder data.
  web_search: {
    started: 'Searching the web…',
    completed: 'Searched the web',
    refused: 'Web search not run',
  },
};

/** One tool call of a live turn; a model response's calls run together. */
export function toolCallLabel({ tool, status }: { tool: string; status: string }): string {
  const builtin = BUILTIN_TOOL_LABEL[tool];
  if (builtin)
    return status === 'started' || status === 'completed' || status === 'refused'
      ? builtin[status]
      : `${builtin.refused} · failed`;
  if (status === 'started')
    return `Reading ${tool.replace(/^(read|get)_/u, '').replaceAll('_', ' ')}…`;
  return runStepLabel({ tool, status });
}

/** The page workspace's suggestion categories (the content rules engine's). */
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

/**
 * How a suggestion's rule strength reads on its card. A requirement restates a
 * search engine policy; recommendations and heuristics are options, and a
 * heuristic is labelled as one. No strength is a score.
 */
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

/** Why a suggestion no longer fits the page, as Apply reports it. */
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

/** A suggestion change the server refused without saying why (`agent_suggestion_conflict`). */
export const SUGGESTION_CONFLICT_COPY =
  'This suggestion can’t be changed now. Reload the page and try again.';

/** A suggestion change or save made against a page that has since changed (`agent_output_conflict`). */
export const PAGE_CHANGED_COPY =
  'The page changed since you opened it. The latest version is shown now; check it and try again.';

export function runErrorCopy(code: string): string {
  return RUN_ERROR_COPY[code] ?? 'The agent could not finish this request. Try again.';
}
