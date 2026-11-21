import type { ActionTargetKind } from '@citeladder/contracts/actions';
import type { IssueFamilyCohort } from '@citeladder/contracts/opportunity-evidence';
import type { Selectable } from 'kysely';

import type { Json } from '../../agent/contracts.ts';
import type { Database } from '../../db/database.ts';
import type { Actions } from '../../generated/db-schema.ts';
import type { OpportunityRow } from '../projection.ts';

export class ActionTargetError extends Error {}

export type TargetScope = Readonly<{ workspaceId: string; projectId: string }>;
export type TargetAction = Selectable<Actions>;
export type DeclaredMember = Pick<OpportunityRow, 'rule_id' | 'evidence'>;

export type ActionTarget = Readonly<{
  group_key: string;
  kind: ActionTargetKind;
  label: string;
  url: string | null;
  prompt_id: string | null;
}>;

export type DeclarationTargets =
  | {
      resolved: true;
      target_site_url_ids: string[];
      target_external_url: string | null;
    }
  | { resolved: false; reason: string };

type ShownCohort = IssueFamilyCohort & {
  crawl_completed_at: string | null;
  crawl_analyzed_url_count: number | null;
};

export type TargetDetail = Readonly<{ editable_page: boolean; cohort: ShownCohort | null }>;

export type ActionTargetModule<K extends ActionTargetKind = ActionTargetKind> = Readonly<{
  kind: K;
  declarationTargets(input: {
    db: Database;
    action: TargetAction;
    members: readonly DeclaredMember[];
    website: string;
  }): Promise<DeclarationTargets>;
  detail(input: {
    db: Database;
    action: TargetAction;
    declaredMemberIds: readonly string[];
  }): Promise<TargetDetail>;
  agentContext(input: {
    db: Database;
    scope: TargetScope;
    action: TargetAction;
  }): Promise<Record<string, Json>>;
}>;

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
