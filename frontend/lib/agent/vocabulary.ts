/**
 * The one place an Agent or Action token becomes something a reader reads.
 *
 * An unmapped token renders as nothing (or a neutral fallback where a label is
 * structurally required), never as the raw backend identifier.
 */
import type { ActionStatus } from '@/lib/api/actions';

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

const TARGET_KIND_LABEL: Record<string, string> = {
  page: 'Page',
  earned_page: 'Earned page',
  product: 'Product',
  category: 'Category',
  query: 'Search query',
  prompt: 'Prompt',
  planned_page: 'Planned page',
};

export const ACTION_TARGET_KINDS = Object.keys(TARGET_KIND_LABEL);

export function targetKindLabel(kind: string | null | undefined): string | null {
  return kind ? (TARGET_KIND_LABEL[kind] ?? null) : null;
}

const FAMILY_LABEL: Record<string, string> = {
  ai_visibility: 'AI Visibility',
  sources: 'Sources',
  search_console: 'Search Console',
  search_intelligence: 'Search Intelligence',
  site_health: 'Site Health',
  link_graph: 'Link graph',
  site_changes: 'Site changes',
  commerce: 'Commerce',
};

export function familyLabel(family: string): string | null {
  return FAMILY_LABEL[family] ?? null;
}

export const FAMILY_STATE_LABEL: Record<string, string> = {
  observed: 'Observed',
  no_finding: 'No finding',
  unavailable: 'Unavailable',
};

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

/** What one expected check asks, before its subject. */
const CHECK_KIND_LABEL: Record<string, string> = {
  site_rule: 'Site Health check passes',
  contextual_link: 'Internal link is on the page',
  visibility_metric: 'Prompt score rises',
  traffic_metric: 'Search Console clicks rise',
  keyword_presence: 'You appear for the search',
};

export function checkKindLabel(kind: string): string {
  return CHECK_KIND_LABEL[kind] ?? 'Check';
}

export const CHECK_STATE_LABEL: Record<'waiting' | 'met' | 'unmet' | 'unavailable', string> = {
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
  not_ranking_yet: 'A later Search Intelligence analysis does not show you ranking yet.',
  still_missing: 'A later Search Intelligence analysis still lists this as a gap.',
  provider_serp_predates_change:
    'DataForSEO last checked this search before the go-live date. A later analysis can answer it.',
};

export function checkReasonLabel(reason: string | null): string | null {
  return reason ? (CHECK_REASON[reason] ?? null) : null;
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

export const OUTPUT_PHASE_LABEL: Record<'outline' | 'draft' | 'final', string> = {
  outline: 'Outline',
  draft: 'Draft',
  final: 'Final',
};

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
  funding_unavailable:
    "No Agent model is configured. Set DEFAULT_AGENT_* in the server's .env and restart, then send it again.",
  provider_error: 'The model provider returned an error. Try again.',
  interrupted: 'The page closed before the agent finished. Nothing was saved; send it again.',
  turn_timeout:
    'This turn ran past its time limit. Nothing was saved; narrow the request and try again.',
  tool_failed: 'A data read failed. Try again.',
  model_refused:
    'The model declined to answer this request. Nothing was saved; rephrase it or ask about one part at a time.',
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

export function runErrorCopy(code: string): string {
  return RUN_ERROR_COPY[code] ?? 'The agent could not finish this request. Try again.';
}
