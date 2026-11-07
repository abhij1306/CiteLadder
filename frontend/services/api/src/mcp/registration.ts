/** MCP call budgets: per grant and per account, with a narrower one for changes. */
import { budget, spendBudget, type Budget } from '../abuse/usage.ts';
import type { Database } from '../db/database.ts';

/** One budget per grant and per account; a client over its own budget spends no other. */
export function admitToolCall(db: Database, grantId: string, userId: string) {
  return admitBudgets(db, [
    [budget('mcp_tool_call_grant'), grantId],
    [budget('mcp_tool_call_user'), userId],
  ]);
}

/** A change also spends a narrower per-grant budget than reads, in the same window. */
export function admitWriteCall(db: Database, grantId: string) {
  return admitBudgets(db, [[budget('mcp_write_call_grant'), grantId]]);
}

async function admitBudgets(db: Database, budgets: readonly (readonly [Budget, string])[]) {
  for (const [limit, subject] of budgets) await spendBudget(db, limit, subject); // NOSONAR -- A refused budget stops before the next is charged.
}
