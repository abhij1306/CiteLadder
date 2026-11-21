import {
  ACTION_BULK_MAX,
  actionTargetKindSchema,
  type ActionGoal,
  type ActionGrouping,
  type ActionMeasurement,
  type ActionStatus,
  type ActionTargetKind,
  type ActionUserStatus,
} from '@citeladder/contracts/actions';
import type { SourceClass } from '@citeladder/contracts/opportunities';
import type { IssueSection } from '@citeladder/contracts/site-health';
import { opportunities } from './opportunity.ts';

const kinds = (...listed: ActionTargetKind[]): ActionTargetKind[] => listed;

const ACTION_GOALS = {
  read_site: ['seo', 'aeo', 'content'],
  own_pages: [
    'prompts',
    'create_content',
    'improve_pages',
    'search_queries',
    'internal_links',
    'regressed',
    'product_pages',
  ],
  mentions: ['editorial', 'ugc', 'references', 'other_sources'],
  wrong_claims: [],
} as const satisfies Record<ActionGoal, readonly ActionGrouping[]>;

type GroupingSource =
  | Readonly<{ kind: 'fixed'; grouping: ActionGrouping }>
  | Readonly<{ kind: 'issue_section' }>
  | Readonly<{ kind: 'source_class' }>;
const fixed = (grouping: ActionGrouping): GroupingSource => ({ kind: 'fixed', grouping });

const RULE_GROUPING: Readonly<Record<string, GroupingSource>> = {
  site_issue_family: { kind: 'issue_section' },
  earned_page_acquire_listing: { kind: 'source_class' },
  brand_absent_high_value_prompt: fixed('prompts'),
  owned_page_not_cited: fixed('prompts'),
  confirmed_prompt_decline: fixed('prompts'),
  low_share_of_voice_theme: fixed('prompts'),
  content_gap_new_page: fixed('create_content'),
  search_keyword_gap: fixed('create_content'),
  content_gap_improve_page: fixed('improve_pages'),
  search_demand_content_gap: fixed('search_queries'),
  striking_distance_query: fixed('search_queries'),
  query_cannibalization: fixed('search_queries'),
  property_relative_ctr_gap: fixed('search_queries'),
  emerging_query: fixed('search_queries'),
  declining_query: fixed('search_queries'),
  high_traffic_low_visibility: fixed('search_queries'),
  site_link_near_orphan: fixed('internal_links'),
  site_contextual_links: fixed('internal_links'),
  site_link_weak_authority: fixed('internal_links'),
  site_change_potential_regression: fixed('regressed'),
  site_change_critical_regression: fixed('regressed'),
  site_change_metadata_inconsistency: fixed('regressed'),
  site_change_cosmetic_refresh: fixed('regressed'),
  product_not_mentioned: fixed('product_pages'),
  price_mismatch: fixed('product_pages'),
  losing_position: fixed('product_pages'),
  merchant_absent: fixed('product_pages'),
  cited_alternatives_without_uploaded_presence: fixed('product_pages'),
  catalog_fields_missing: fixed('product_pages'),
};

const ISSUE_SECTION_GROUPING = {
  technical: 'seo',
  aeo: 'aeo',
  content: 'content',
} as const satisfies Record<IssueSection, ActionGrouping>;

const SOURCE_CLASS_GROUPING: Readonly<Partial<Record<SourceClass, ActionGrouping>>> = {
  editorial_third_party: 'editorial',
  community: 'ugc',
  social: 'ugc',
  video: 'ugc',
  review_marketplace: 'ugc',
  institutional: 'references',
};

export const actions = {
  ACTION_STATUS_OPEN: 'open',
  ACTION_GROUPING_VERSION: 'action-grouping-1',
  ACTION_DIAGNOSIS_VERSION: 'action-diagnosis-1',
  ACTION_PRIORITY_VERSION: 'action-priority-1',
  ACTION_TARGET_KINDS: actionTargetKindSchema.options,
  AGENT_TARGET_KINDS: ['page', 'planned_page'] as const satisfies readonly ActionTargetKind[],
  PLANNED_PAGE_TOPIC_MAX_CHARS: 120,
  ACTION_ORIGIN_EVIDENCE: 'evidence',
  ACTION_ORIGIN_AGENT: 'agent',
  ACTION_STATUS_IN_PROGRESS: 'in_progress',
  ACTION_STATUS_DISMISSED: 'dismissed',
  ACTION_STATUS_IMPLEMENTED: 'implemented',
  ACTION_STATUS_MEASURING: 'measuring',
  ACTION_STATUS_DONE: 'done',
  ACTION_STATUS_VIEW: {
    open: { status: 'open', measurement: null },
    in_progress: { status: 'in_progress', measurement: null },
    dismissed: { status: 'dismissed', measurement: null },
    implemented: { status: 'done', measurement: 'measuring' },
    measuring: { status: 'done', measurement: 'measuring' },
    done: { status: 'done', measurement: 'verified' },
  } as const satisfies Record<
    string,
    { status: ActionStatus; measurement: ActionMeasurement | null }
  >,
  ACTION_TRANSITIONS: {
    open: ['in_progress', 'dismissed'],
    in_progress: ['dismissed'],
    dismissed: ['open', 'in_progress'],
    implemented: [],
  } as const satisfies Record<string, readonly ActionUserStatus[]>,
  ACTION_DECLARABLE_STATUSES: ['in_progress', 'open'],
  ACTION_ACTIVE_STATUSES: ['in_progress', 'open'],
  ACTION_BULK_MAX,
  ACTION_SEARCH_MAX_CHARS: 200,
  EVIDENCE_FAMILIES: [
    'ai_visibility',
    'sources',
    'search_console',
    'search_intelligence',
    'site_health',
    'link_graph',
    'site_changes',
    'commerce',
    'content_optimization',
  ],
  RULE_EVIDENCE_FAMILY: {
    content_gap_improve_page: 'content_optimization',
    content_gap_new_page: 'content_optimization',
    brand_absent_high_value_prompt: 'ai_visibility',
    owned_page_not_cited: 'ai_visibility',
    confirmed_prompt_decline: 'ai_visibility',
    earned_page_acquire_listing: 'sources',
    site_link_near_orphan: 'link_graph',
    site_contextual_links: 'link_graph',
    site_issue_family: 'site_health',
    site_link_weak_authority: 'link_graph',
    site_change_potential_regression: 'site_changes',
    site_change_critical_regression: 'site_changes',
    site_change_metadata_inconsistency: 'site_changes',
    site_change_cosmetic_refresh: 'site_changes',
    search_demand_content_gap: 'search_console',
    striking_distance_query: 'search_console',
    query_cannibalization: 'search_console',
    property_relative_ctr_gap: 'search_console',
    emerging_query: 'search_console',
    declining_query: 'search_console',
    search_keyword_gap: 'search_intelligence',
    low_share_of_voice_theme: 'ai_visibility',
    high_traffic_low_visibility: 'search_console',
    product_not_mentioned: 'commerce',
    price_mismatch: 'commerce',
    losing_position: 'commerce',
    merchant_absent: 'commerce',
    cited_alternatives_without_uploaded_presence: 'commerce',
    catalog_fields_missing: 'commerce',
  },
  ACTION_PRIORITY_ROUNDING_DECIMALS: 1,
  APPROACH_TREE: [
    {
      approach: 'earned_placement',
      rule_ids: ['earned_page_acquire_listing'],
      skill_id: 'earned_authority',
      messages: [
        'Draft a request to be listed on {target}, alongside {competitors}.',
        'Draft a request to be listed on {target}.',
      ],
      donts: [
        'Do not change an owned page to fix a third-party listing.',
        'Do not send outreach from CiteLadder; drafts only.',
      ],
      target_kinds: kinds(),
    },
    {
      approach: 'fix_technical',
      rule_ids: ['site_issue_family'],
      skill_id: 'technical_health',
      messages: ['Write one fix that clears "{target}" on every affected page.'],
      donts: [
        'Do not fix the affected pages one by one when one shared template or component causes the issue.',
        'Do not rewrite the page copy to work around a technical defect.',
      ],
      target_kinds: kinds('issue_family'),
    },
    {
      approach: 'fix_technical',
      rule_ids: ['site_change_critical_regression', 'site_change_potential_regression'],
      skill_id: 'technical_health',
      messages: ['Fix "{issue}" on {target}.', 'Fix the technical issues on {target}.'],
      donts: [
        'Do not rewrite the page copy to work around a technical defect.',
        'Do not add markup that states facts the visible page does not.',
      ],
      target_kinds: kinds(),
    },
    {
      approach: 'consolidate',
      rule_ids: ['query_cannibalization'],
      skill_id: 'gsc_optimize',
      messages: ['Merge or differentiate the pages that compete for {target}.'],
      donts: ['Do not create another URL for this demand.'],
      target_kinds: kinds(),
    },
    {
      approach: 'create_new',
      rule_ids: ['brand_absent_high_value_prompt'],
      skill_id: 'content_create',
      messages: ['Write a page that answers the prompt "{target}".'],
      donts: [
        'Do not create a new URL if an existing page already answers this question; improve that page instead.',
      ],
      target_kinds: kinds('prompt'),
    },
    {
      approach: 'create_new',
      rule_ids: ['search_keyword_gap'],
      skill_id: 'content_create',
      messages: ['Write a page for the search "{target}".'],
      donts: [
        'Do not create a new URL if an existing page already answers this search; improve that page instead.',
        'Do not present provider ranking estimates as measured traffic.',
      ],
      target_kinds: kinds('planned_page'),
    },
    {
      approach: 'create_new',
      rule_ids: ['content_gap_new_page'],
      skill_id: 'content_create',
      messages: [
        'Write a page about {angle} for the prompts in this Action.',
        'Write a page about {target} for the prompts in this Action.',
      ],
      donts: [
        'Do not claim the page will be cited.',
        'Do not invent statistics, quotes or sources.',
      ],
      target_kinds: kinds('planned_page'),
      handoff: { workflow_id: 'article', context: 'opportunity' },
    },
    {
      approach: 'improve_existing',
      rule_ids: ['content_gap_improve_page'],
      skill_id: 'content_create',
      messages: [
        'Improve {target} so AI answers cite it for {angle}.',
        'Improve {target} so AI answers cite it for the prompts in this Action.',
      ],
      donts: [
        'Do not claim the page will be cited.',
        'Do not invent statistics, quotes or sources.',
      ],
      target_kinds: kinds('page'),
      handoff: { workflow_id: 'optimize_page', context: 'page_url' },
    },
    {
      approach: 'improve_links',
      rule_ids: ['site_contextual_links', 'site_link_near_orphan', 'site_link_weak_authority'],
      skill_id: 'internal_links',
      messages: [
        'Fix "{issue}" on {target} with internal links.',
        'Improve the internal links of {target}.',
      ],
      donts: ['Do not add links from unrelated pages to hit a link count.'],
      target_kinds: kinds(),
    },
    {
      approach: 'improve_existing',
      rule_ids: [
        'declining_query',
        'emerging_query',
        'property_relative_ctr_gap',
        'search_demand_content_gap',
        'striking_distance_query',
      ],
      skill_id: 'gsc_optimize',
      messages: [
        'Improve {target} for its search demand: "{issue}".',
        'Improve {target} for its search demand.',
      ],
      donts: ['Do not create another URL: an indexable page already maps to this demand.'],
      target_kinds: kinds(),
    },
  ],
  DEFAULT_APPROACH: {
    approach: 'improve_existing',
    rule_ids: [],
    skill_id: 'content_create',
    messages: ['Work on {target}: "{issue}".', 'Work on {target}.'],
    donts: ['Do not create another URL for a target that already has a page.'],
    target_kinds: kinds(),
  },
  AGENT_ORIGIN_DEFAULT_SKILL: 'content_create',
  ACTION_GOALS,
  RULE_GROUPING,
  ISSUE_SECTION_GROUPING,
  SOURCE_CLASS_GROUPING,
  SOURCE_CLASS_GROUPING_DEFAULT: 'other_sources' as const satisfies ActionGrouping,
  AGENT_KIND_GROUPING: { planned_page: 'create_content' } as Readonly<
    Partial<Record<string, ActionGrouping>>
  >,
  ACTION_GROUPING_FALLBACK: 'improve_pages' as const satisfies ActionGrouping,
  ACTION_TREE_PAGE_SIZE: 10,
  ACTION_BLOCKING_GROUPINGS: ['seo', 'aeo'] as const satisfies readonly ActionGrouping[],
  ACTION_BLOCKING_MIN_PRIORITY: 40,
  ACTION_URLS_PAGE_SIZE: 10,
  ACTION_PRIORITY_BANDS: { high: 30, medium: 20 },
  LEG_VISIBILITY_RUN: 'next_visibility_run' as const,
  LEG_SEARCH_CONSOLE_WINDOW: 'next_search_console_window' as const,
  LEG_CRAWL: 'next_crawl' as const,
  LEG_STATE_WAITING: 'waiting',
  LEG_STATE_NOT_SCHEDULED: 'not_scheduled',
  LEG_STATE_SYNC_NEEDED: 'sync_needed',
  LEG_STATE_OBSERVED: 'observed',
  SEARCH_CONSOLE_FINALIZATION_LAG_DAYS: 3,
  ACTION_LIST_DEFAULT_LIMIT: 50,
  ACTION_LIST_MAX_LIMIT: 200,
  ACTION_LABEL_MAX_CHARS: 255,
};

const unmappedRules = Object.keys(opportunities.OPPORTUNITY_RULES_BY_ID).filter(
  (rule) => !Object.hasOwn(actions.RULE_EVIDENCE_FAMILY, rule),
);
if (unmappedRules.length)
  throw new Error(`Rules without an evidence family: ${unmappedRules.join(', ')}`);

const ungroupedRules = Object.keys(opportunities.OPPORTUNITY_RULES_BY_ID).filter(
  (rule) => !Object.hasOwn(RULE_GROUPING, rule),
);
if (ungroupedRules.length)
  throw new Error(`Rules without an Actions grouping: ${ungroupedRules.join(', ')}`);

const HANDOFF_FACTS = new Set(['target', 'issue', 'angle', 'competitors']);
for (const branch of [...actions.APPROACH_TREE, actions.DEFAULT_APPROACH]) {
  const named = branch.messages.map((template) =>
    [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]),
  );
  const unknown = named.flat().filter((name) => !HANDOFF_FACTS.has(name ?? ''));
  const last = named.at(-1) ?? [];
  if (unknown.length || !last.every((name) => name === 'target'))
    throw new Error(
      `Handoff messages of ${branch.approach} name an unknown fact or do not end on {target} alone`,
    );
}
