/**
 * One expected-check kind: which rules freeze it, which reading measures it,
 * which evidence sources read it, and how a reader names it. Every kind is a
 * module in this folder; nothing else branches on a check's kind.
 */
import type { measurementLegSchema } from '@citeladder/contracts/actions';
import type { ExpectedCheck } from '@citeladder/contracts/opportunities';
import type { z } from 'zod';
import type { Database } from '../../db/database.ts';
import type { OpportunityRow } from '../projection.ts';
import type { Scope } from '../sources.ts';
import type { ReadContext, Source } from './read-context.ts';
import type { CheckOutcome } from '../verification-decisions.ts';

export type CheckKind = ExpectedCheck['kind'];
type ChecksByKind = { [C in ExpectedCheck as C['kind']]: C };
export type CheckOf<K extends CheckKind> = ChecksByKind[K];
export type MeasurementLeg = z.infer<typeof measurementLegSchema>['leg'];
/** The evidence an announcement names; each re-reads the checks it can measure. */
export type SourceKind =
  | 'site_crawl'
  | 'audit'
  | 'traffic_snapshot'
  | 'search_intelligence_dataset';

/** What deciding whether a member can be measured reads, before any baseline. */
export type MemberFacts = Pick<
  OpportunityRow,
  'rule_id' | 'target_prompt_id' | 'target_theme' | 'target_url' | 'evidence'
>;
/** A frozen check and the finding it measures; null for Analyze a page's prompts. */
export type MemberCheck = { check: ExpectedCheck; member: OpportunityRow | null };
export type FreezeContext = {
  db: Database;
  scope: Scope;
  auditId: string | null;
  /** The go-live instant (UTC ISO) and its day. */
  declaredAt: string;
  declaredDay: string;
  /** The output revision the user shipped; null for work done outside CiteLadder. */
  outputRevisionId: string | null;
  /** Contextual links are declared per selected suggestion. */
  recommendationIds: string[];
};

/** Method signatures keep the registry's per-kind modules assignable to the union. */
export interface CheckModule<K extends CheckKind> {
  readonly kind: K;
  readonly leg: MeasurementLeg;
  readonly sources: readonly SourceKind[];
  /** Whether `freeze` would produce a check for this member. */
  measurable(member: MemberFacts): boolean;
  /** The checks a declaration freezes for this kind's members, baselines included. */
  freeze(members: OpportunityRow[], context: FreezeContext): Promise<MemberCheck[]>;
  /** This source's reading of one frozen check; null when it says nothing about it. */
  read(ctx: ReadContext, source: Source, check: CheckOf<K>): Promise<CheckOutcome | null>;
  /** What the check names for a reader: rule, prompt, page or query, link, search. */
  subject(check: CheckOf<K>, prompts: ReadonlyMap<string, string>): string | null;
}
