import { budget, spendBudget } from '../abuse/usage.ts';
import type { SettingSource } from '../config/settings.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { crawlRequest } from './crawl-request.ts';
import { createCrawl } from './planner.ts';

export type CrawlStart = Readonly<{
  workspaceId: string;
  projectId: string;
  robots: 'respect' | 'ignore' | null | undefined;
  user: Readonly<{ id: string; email: string }>;
}>;

function robotsChoice({ robots, user }: CrawlStart): Parameters<typeof crawlRequest>[3] {
  switch (robots) {
    case undefined:
    case null:
      return null;
    case 'respect':
      return { robots: 'respect' };
    case 'ignore':
      return {
        robots: 'ignore',
        decision: { user_id: user.id, email: user.email, decided_at: new Date().toISOString() },
      };
    default: {
      const unhandled: never = robots;
      throw new Error(`Unknown robots choice: ${String(unhandled)}`);
    }
  }
}

export async function startCrawl(db: Database, settings: SettingSource, start: CrawlStart) {
  const choice = robotsChoice(start);
  await spendBudget(db, budget('crawl_create', settings), start.workspaceId);
  return inTransaction(db, async (trx) =>
    createCrawl(
      trx,
      start.workspaceId,
      await crawlRequest(trx, start.workspaceId, start.projectId, choice),
    ),
  );
}
