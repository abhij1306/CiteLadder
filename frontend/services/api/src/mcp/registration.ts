/** MCP call budgets: per grant and per account, with a narrower one for changes. */
import { budget, spendBudget, type Budget } from '../abuse/usage.ts';
import type { Database } from '../db/database.ts';

export function admitToolCall(db: Database, grantId: string, userId: string) {
  return admitBudgets(db, [
    [budget('mcp_tool_call_grant'), grantId],
    [budget('mcp_tool_call_user'), userId],
  ]);
}

async function admitBudgets(db: Database, budgets: readonly (readonly [Budget, string])[]) {
  for (const [limit, subject] of budgets) await spendBudget(db, limit, subject); // NOSONAR
}
