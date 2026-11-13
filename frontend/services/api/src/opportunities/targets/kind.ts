/**
 * What every Action target kind provides (`registry.ts` lists them): the
 * interface the refresh, the Agent, declarations and reads use, so no caller
 * branches on a target kind or builds a group key.
 */
import type { ActionTargetKind } from '@citeladder/contracts/actions';
import type { IssueFamilyCohort } from '@citeladder/contracts/opportunity-evidence';
import type { Selectable } from 'kysely';

import type { Json } from '../../agent/contracts.ts';
import type { Database } from '../../db/database.ts';
import type { Actions } from '../../generated/db-schema.ts';
import type { OpportunityRow } from '../projection.ts';

/** A target the Agent names that no Action can carry. */
export class ActionTargetError extends Error {}

export type TargetScope = Readonly<{ workspaceId: string; projectId: string }>;
export type TargetAction = Selectable<Actions>;
/** What a declaration reads of each finding it freezes. */
export type DeclaredMember = Pick<OpportunityRow, 'rule_id' | 'evidence'>;

/** What one Action is about: `group_key` is its identity, `label` what its list shows. */
export type ActionTarget = Readonly<{
  group_key: string;
  kind: ActionTargetKind;
  label: string;
  url: string | null;
  prompt_id: string | null;
}>;

/** The pages a declaration covers, or why it cannot resolve them (a 409 to the caller). */
export type DeclarationTargets =
  | {
      resolved: true;
      target_site_url_ids: string[];
      target_external_url: string | null;
    }
  | { resolved: false; reason: string };

/** An issue-family cohort as a read shows it, with when its crawl completed. */
type ShownCohort = IssueFamilyCohort & { crawl_completed_at: string | null };

/** What an Action's detail read adds for its kind. */
export type TargetDetail = Readonly<{ editable_page: boolean; cohort: ShownCohort | null }>;

export type ActionTargetModule<K extends ActionTargetKind = ActionTargetKind> = Readonly<{
  kind: K;
  /** The pages a declaration of the Action covers, from the members it freezes. */
  declarationTargets(input: {
    db: Database;
    action: TargetAction;
    members: readonly DeclaredMember[];
    website: string;
  }): Promise<DeclarationTargets>;
  /** The detail read's additions; `declaredMemberIds` are the findings a declaration froze. */
  detail(input: {
    db: Database;
    action: TargetAction;
    declaredMemberIds: readonly string[];
  }): Promise<TargetDetail>;
  /** What an Agent chat on the Action is given beyond the row's own fields. */
  agentContext(input: {
    db: Database;
    scope: TargetScope;
    action: TargetAction;
  }): Promise<Record<string, Json>>;
}>;

/** A kind the Agent may name: it resolves the named text to the Action's identity. */
export type AgentNamedTargetModule<K extends ActionTargetKind = ActionTargetKind> =
  ActionTargetModule<K> &
    Readonly<{
      named(input: {
        db: Database;
        scope: TargetScope;
        website: string;
        text: string;
      }): Promise<{ key: string; url: string | null }>;
    }>;

export const NO_DETAIL: TargetDetail = { editable_page: false, cohort: null };
