import type { Database } from '../db/database.ts';
import { CHECKS, CHECK_KINDS, ruleCheckKind } from './checks/registry.ts';
import type { CheckKind, MemberCheck } from './checks/kind.ts';
import type { OpportunityRow } from './projection.ts';
import type { Scope } from './sources.ts';

export async function declarationChecks(
  db: Database,
  scope: Scope,
  members: OpportunityRow[],
  context: { auditId: string | null; declaredAt: string; outputRevisionId: string | null },
  recommendationIds: string[] = [],
): Promise<MemberCheck[]> {
  const byKind = new Map<CheckKind, OpportunityRow[]>();
  for (const member of members) {
    const kind = ruleCheckKind(member.rule_id);
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), member]);
  }
  const checks = new Map<string, MemberCheck>();
  const freezing = {
    db,
    scope,
    ...context,
    declaredDay: context.declaredAt.slice(0, 10),
    recommendationIds,
  };
  for (const kind of CHECK_KINDS) {
    const found = await CHECKS[kind].freeze(byKind.get(kind) ?? [], freezing); // NOSONAR -- One transaction connection.
    for (const item of found) {
      const key = JSON.stringify(item.check);
      if (!checks.has(key)) checks.set(key, item);
    }
  }
  return [...checks.values()];
}
