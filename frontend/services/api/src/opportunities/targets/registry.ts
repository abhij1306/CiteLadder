/**
 * Every Action target kind, and the one map from an Opportunity target to the
 * Action it groups into. The refresh, the Agent, declarations and reads ask
 * here; no caller branches on a target kind or builds a group key.
 */
import { actionTargetKindSchema, type ActionTargetKind } from '@citeladder/contracts/actions';

import type { ActionMember } from '../../analysis/opportunities/actions.ts';
import { targetColumns, targetKey } from '../../analysis/opportunities/targets.ts';
import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors.ts';
import { earnedPageTarget } from './earned-page.ts';
import { issueFamilyTarget } from './issue-family.ts';
import {
  ActionTargetError,
  type ActionTarget,
  type ActionTargetModule,
  type AgentNamedTargetModule,
  type DeclaredMember,
  type TargetAction,
  type TargetScope,
} from './kind.ts';
import { pageKey, pageTarget } from './page.ts';
import { plannedPageKey, plannedPageTarget } from './planned-page.ts';
import { plainTarget } from './shared.ts';

export { ActionTargetError, type ActionTarget } from './kind.ts';
export { actionPageUrl } from './page.ts';
export { plannedPageKey } from './planned-page.ts';
export { storedCohort } from './issue-family.ts';

const p = policy.opportunity.actions;

const TARGETS: { readonly [K in ActionTargetKind]: ActionTargetModule<K> } = {
  page: pageTarget,
  earned_page: earnedPageTarget,
  product: plainTarget('product'),
  category: plainTarget('category'),
  query: plainTarget('query'),
  prompt: plainTarget('prompt'),
  planned_page: plannedPageTarget,
  issue_family: issueFamilyTarget,
};

/** A target kind the Agent may name (`AGENT_TARGET_KINDS`). */
export type AgentTargetKind = (typeof p.AGENT_TARGET_KINDS)[number];
const NAMED: { readonly [K in AgentTargetKind]: AgentNamedTargetModule<K> } = {
  page: pageTarget,
  planned_page: plannedPageTarget,
};

const AGENT_KINDS: readonly unknown[] = p.AGENT_TARGET_KINDS;
export const isAgentTargetKind = (kind: unknown): kind is AgentTargetKind =>
  AGENT_KINDS.includes(kind);

/** The module of a stored Action's kind; the column holds only contract kinds. */
const moduleOf = (action: Pick<TargetAction, 'target_kind'>): ActionTargetModule =>
  TARGETS[actionTargetKindSchema.parse(action.target_kind)];

function target(
  member: Pick<ActionMember, 'target' | 'label_hint' | 'title'>,
  group_key: string,
  kind: ActionTargetKind,
  { url = null, prompt = null }: { url?: string | null; prompt?: string | null } = {},
): ActionTarget {
  const theme = targetColumns(member.target).target_theme;
  return {
    group_key,
    kind,
    label: [...(url || member.label_hint || theme || member.title)]
      .slice(0, p.ACTION_LABEL_MAX_CHARS)
      .join(''),
    url,
    prompt_id: prompt,
  };
}

/** The Action a finding groups into: one per page, prompt, query, product, listing or issue family. */
export function actionTargetOf(
  member: Pick<ActionMember, 'target' | 'label_hint' | 'title'>,
): ActionTarget {
  const ref = member.target;
  const key = targetKey(ref);
  const page = (url: string) => target(member, pageKey(url), 'page', { url });
  switch (ref.kind) {
    case 'issue_family':
      return target(member, key, 'issue_family');
    case 'earned_page':
      return target(member, `earned:${key}`, 'earned_page', { url: ref.url });
    case 'product':
      return target(member, key, 'product');
    case 'category':
      return target(member, key, 'category');
    case 'prompt':
      return target(member, key, 'prompt', { prompt: ref.prompt_id });
    case 'prompt_index':
      return target(member, key, 'prompt');
    case 'site_page':
    case 'site_change':
    case 'link_source':
      return page(ref.url);
    case 'demand':
      if (ref.url) return page(ref.url);
      return ref.query
        ? target(member, `query:${ref.query.toLowerCase().trim()}`, 'query')
        : target(member, key, 'query');
    case 'search_gap': {
      if (ref.url) return page(ref.url);
      // A keyword gap no existing page covers is a page to create.
      const planned = plannedPageKey(ref.keyword);
      return planned ? target(member, planned, 'planned_page') : target(member, key, 'query');
    }
    case 'planned_page':
      // The stored key is the group key, so a renamed label keeps its Action.
      return target(member, ref.key, 'planned_page');
    default: {
      const unknownTarget: never = ref;
      throw new Error(`Unknown Opportunity target: ${JSON.stringify(unknownTarget)}`);
    }
  }
}

/**
 * The Action a target the Agent names would be, without creating it: equal
 * keys are one Action. Throws `ActionTargetError` for a kind the Agent cannot
 * name or a target no Action can carry.
 */
export async function namedTarget(
  db: Database,
  scope: TargetScope,
  kind: string,
  rawText: string,
): Promise<{ kind: AgentTargetKind; key: string; url: string | null; text: string }> {
  if (!isAgentTargetKind(kind)) throw new ActionTargetError('Unsupported Agent target');
  const text = rawText.trim();
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const identity = await NAMED[kind].named({ db, scope, website: project.website_url, text });
  return { kind, text, ...identity };
}

/** The pages a declaration of `action` covers, from the members it freezes. */
export const declarationTargets = (
  db: Database,
  action: TargetAction,
  members: readonly DeclaredMember[],
  website: string,
) => moduleOf(action).declarationTargets({ db, action, members, website });

/** What an Action's detail read adds for its kind: whether its page is editable, its cohort. */
export const targetDetail = (
  db: Database,
  action: TargetAction,
  declaredMemberIds: readonly string[],
) => moduleOf(action).detail({ db, action, declaredMemberIds });

/** What an Agent chat on `action` is given beyond the row's own fields. */
export const targetAgentContext = (db: Database, scope: TargetScope, action: TargetAction) =>
  moduleOf(action).agentContext({ db, scope, action });
