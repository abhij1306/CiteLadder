/**
 * One source's reading of a declaration's expected checks. Each source reads
 * only the check kinds it can measure and leaves the others untouched, so
 * their earlier states carry forward in the merged observation.
 */
import { expectedCheckSchema, type ExpectedCheck } from '@citeladder/contracts/opportunities';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { record } from '../db/json.ts';
import { checkWindowDays, evaluation, outcome, type Evaluation } from './verification-decisions.ts';
import type { Declaration } from './verification-result.ts';
import { CHECKS, SOURCE_CHECK_KINDS } from './checks/registry.ts';
import type { CheckKind, CheckModule } from './checks/kind.ts';
import type { ReadContext, Source } from './checks/read-context.ts';

const DAY_MS = 86_400_000;
const checksOf = (d: Declaration) =>
  Array.isArray(d.expected_checks) ? d.expected_checks.map(record) : [];

function readCheck(ctx: ReadContext, source: Source, check: ExpectedCheck) {
  const module: CheckModule<CheckKind> = CHECKS[check.kind];
  return module.read(ctx, source, check);
}

/** This source's outcomes for the declaration's checks it can read. */
export async function evidenceFor(
  db: Database,
  declaration: Declaration,
  source: Source,
): Promise<Evaluation> {
  const ctx: ReadContext = {
    db,
    declaration,
    scope: new WorkspaceScope(declaration.workspace_id),
    result: evaluation(),
    reads: new Map(),
    reading: { observed_at: source.observed_at, source_kind: source.kind, source_id: source.id },
  };
  const readable = SOURCE_CHECK_KINDS[source.kind];
  const age = Date.parse(source.observed_at) - Date.parse(declaration.declared_implemented_at);
  for (const [index, raw] of checksOf(declaration).entries()) {
    const kind = readable.find((item) => item === raw.kind);
    if (!kind) continue;
    // Past its own window a check keeps its last reading.
    if (age > checkWindowDays(kind) * DAY_MS) continue;
    // A frozen check that no longer parses cannot be read; say so rather than wait.
    const parsed = expectedCheckSchema.safeParse(raw);
    // One source reads its checks in order on the caller's connection.
    const found = parsed.success
      ? await readCheck(ctx, source, parsed.data) // NOSONAR
      : outcome(ctx.reading, 'unavailable', 'malformed_check');
    if (found) ctx.result.outcomes.set(index, found);
  }
  return ctx.result;
}
