/** Actions catalog: deterministic decisions over persisted evidence. */
import {
  actionTargetKindSchema,
  type ActionGroup,
  type ActionTargetKind,
} from '@citeladder/contracts/actions';
import { opportunities } from './opportunity.ts';

/** One group rule: it admits an Action whose target kind and approach are both listed; an absent list admits every value. */
export type ActionGroupRule = Readonly<{
  group: ActionGroup;
  target_kinds?: readonly ActionTargetKind[];
  approaches?: readonly string[];
}>;

/** An approach branch's target kinds, checked against the contract's; none admits every kind. */
const kinds = (...listed: ActionTargetKind[]): ActionTargetKind[] => listed;

/**
 * The Actions list's groups (AS2), derived at read time from the stored
 * target kind and approach; no column holds them. An Action belongs to the
 * FIRST rule that admits it, else to `ACTION_GROUP_DEFAULT`, so each Action
 * lands in exactly one group.
 */
const ACTION_GROUPS: readonly ActionGroupRule[] = [
  { group: 'products', target_kinds: ['product', 'category'] },
  { group: 'earned', approaches: ['earned_placement'] },
  { group: 'fix_site', approaches: ['fix_technical', 'improve_links'] },
];
const ACTION_GROUP_DEFAULT: ActionGroup = 'own_pages';

export const actions = {
  ACTION_STATUS_OPEN: 'open',
  ACTION_GROUPING_VERSION: 'action-grouping-1',
  ACTION_DIAGNOSIS_VERSION: 'action-diagnosis-1',
  ACTION_PRIORITY_VERSION: 'action-priority-1',
  ACTION_TARGET_KINDS: actionTargetKindSchema.options,
  /** The target kinds a document the Agent saves may name, and an Agent-origin Action may have. */
  AGENT_TARGET_KINDS: ['page', 'planned_page'] as const satisfies readonly ActionTargetKind[],
  PLANNED_PAGE_TOPIC_MAX_CHARS: 120,
  ACTION_ORIGIN_EVIDENCE: 'evidence',
  ACTION_ORIGIN_AGENT: 'agent',
  ACTION_STATUS_IN_PROGRESS: 'in_progress',
  ACTION_STATUS_IMPLEMENTED: 'implemented',
  ACTION_STATUS_MEASURING: 'measuring',
  ACTION_STATUS_DONE: 'done',
  ACTION_STATUSES: ['open', 'in_progress', 'implemented', 'measuring', 'done', 'dismissed'],
  ACTION_USER_STATUSES: ['dismissed', 'open'],
  ACTION_ACTIVE_STATUSES: ['in_progress', 'open'],
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
    missing_structured_data: 'site_health',
    schema_properties_incomplete: 'site_health',
    schema_visible_content_conflict: 'site_health',
    content_structure_incomplete: 'site_health',
    citability_trust_incomplete: 'site_health',
    site_link_near_orphan: 'link_graph',
    site_contextual_links: 'link_graph',
    site_link_weak_authority: 'link_graph',
    site_issue_family: 'site_health',
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
  // Each branch's `messages` prefill the Agent chat an Action opens (AS3): the
  // first template whose placeholders the Action's own evidence fills is used,
  // so a missing fact drops to a plainer sentence rather than being invented.
  // `{target}` is the Action's label; `{issue}` the title of the branch's
  // strongest finding; `{angle}` a content gap's angle; `{competitors}` the
  // competitors read on an earned page. The last template of every branch
  // names `{target}` alone, so one always fills.
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
      // One fix for a defect a shared template or component causes on every page.
      approach: 'fix_technical',
      rule_ids: ['site_issue_family'],
      skill_id: 'technical_health',
      messages: ['Write one fix that clears "{target}" on every affected page.'],
      donts: [
        'Do not fix the affected pages one by one when one shared template or component causes the defect.',
        'Do not rewrite the page copy to work around a technical defect.',
      ],
      target_kinds: kinds('issue_family'),
    },
    {
      approach: 'fix_technical',
      rule_ids: [
        'missing_structured_data',
        'schema_properties_incomplete',
        'schema_visible_content_conflict',
        'site_change_critical_regression',
        'site_change_potential_regression',
      ],
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
      // The Agent workflow (`workflows.json` id) a finding of this branch hands
      // off with, and what it carries: the finding's Opportunity, or the page URL.
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
      // The page is fetched into a page document before the first turn (phase 2, E3).
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
  ACTION_GROUPS,
  /**
   * Every Action no group rule admits: creating, improving or merging your
   * own pages (pages, planned pages, queries, prompts), and an Agent-origin
   * Action whose approach is not diagnosed yet.
   */
  ACTION_GROUP_DEFAULT,
  /**
   * Floors of an Action's priority bands. A crawl or catalog finding scores its
   * severity × 10 (critical 40, high 30, medium 20, low 10), so these keep its
   * band equal to its severity; a prompt gap's value and gap factors lift it.
   * An unscored Action has no band.
   */
  ACTION_PRIORITY_BANDS: { high: 30, medium: 20 },
  // Each check kind names its reading (`opportunities/checks/`).
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

// Every detector must name its evidence source, for diagnosis and measurement.
const unmappedRules = Object.keys(opportunities.OPPORTUNITY_RULES_BY_ID).filter(
  (rule) => !Object.hasOwn(actions.RULE_EVIDENCE_FAMILY, rule),
);
if (unmappedRules.length)
  throw new Error(`Rules without an evidence family: ${unmappedRules.join(', ')}`);

// An issue-family rule maps to its family finding only, never to a per-page one.
const perPageFamilyRules = Object.keys(opportunities.SITE_ISSUE_TO_OPPORTUNITY_RULE_ID).filter(
  (rule) => rule.startsWith(opportunities.SITE_ISSUE_FAMILY.ISSUE_RULE_PREFIX),
);
if (perPageFamilyRules.length)
  throw new Error(`Issue-family rules mapped per page: ${perPageFamilyRules.join(', ')}`);

// Every handoff template names known facts, and every branch ends on one that
// needs only the Action's label, so a message always fills.
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
