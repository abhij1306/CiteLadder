/** MCP call budgets: per grant and per account, with a narrower one for changes. */
import { enforceSubjectRequest } from '../abuse/usage.ts';
import type { Database } from '../db/database.ts';
import { mcpPolicy } from './config.ts';

/** One budget per grant and per account; a client over its own budget spends no other. */
export function admitToolCall(db: Database, grantId: string, userId: string) {
  const window = mcpPolicy.tool_call_window_seconds;
  return admitBudgets(db, [
    ['mcp_grant', grantId, 'mcp.tool_call.grant', mcpPolicy.tool_call_grant_limit, window],
    ['user', userId, 'mcp.tool_call.user', mcpPolicy.tool_call_user_limit, window],
  ]);
}

/** A change also spends a narrower per-grant budget than reads, in the same window. */
export function admitWriteCall(db: Database, grantId: string) {
  return admitBudgets(db, [
    [
      'mcp_grant',
      grantId,
      'mcp.write_call.grant',
      mcpPolicy.write_call_grant_limit,
      mcpPolicy.tool_call_window_seconds,
    ],
  ]);
}

async function admitBudgets(
  db: Database,
  budgets: readonly (readonly [
    Parameters<typeof enforceSubjectRequest>[1],
    string,
    string,
    number,
    number,
  ])[],
) {
  for (const [kind, subject, operation, limit, windowSeconds] of budgets)
    await enforceSubjectRequest(db, kind, subject, { operation, limit, windowSeconds });
}
