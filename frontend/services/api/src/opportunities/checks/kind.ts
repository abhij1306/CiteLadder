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
export type SourceKind =
  | 'site_crawl'
  | 'audit'
  | 'traffic_snapshot'
  | 'search_intelligence_dataset';

export type MemberFacts = Pick<
  OpportunityRow,
  'rule_id' | 'target_prompt_id' | 'target_theme' | 'target_url' | 'evidence'
>;
export type MemberCheck = { check: ExpectedCheck; member: OpportunityRow | null };
export type FreezeContext = {
  db: Database;
  scope: Scope;
  auditId: string | null;
  declaredAt: string;
  declaredDay: string;
  outputRevisionId: string | null;
  recommendationIds: string[];
};

/** Method signatures keep the registry's per-kind modules assignable to the union. */
export interface CheckModule<K extends CheckKind> {
  readonly kind: K;
  readonly leg: MeasurementLeg;
  readonly sources: readonly SourceKind[];
  measurable(member: MemberFacts): boolean;
  freeze(members: OpportunityRow[], context: FreezeContext): Promise<MemberCheck[]>;
  read(ctx: ReadContext, source: Source, check: CheckOf<K>): Promise<CheckOutcome | null>;
  subject(check: CheckOf<K>, prompts: ReadonlyMap<string, string>): string | null;
}
