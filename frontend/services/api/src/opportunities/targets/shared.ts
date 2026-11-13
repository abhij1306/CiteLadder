/** What several target kinds share: the declared pages a finding's evidence names. */
import type { ActionTargetKind } from '@citeladder/contracts/actions';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record } from '../../db/json.ts';
import { parseUuids } from '../../http/uuid.ts';
import {
  NO_DETAIL,
  type ActionTargetModule,
  type DeclarationTargets,
  type DeclaredMember,
  type TargetAction,
} from './kind.ts';

const o = policy.opportunity.opportunities;

/** The ids among `pages`, deduplicated and in order, that are the project's own crawled pages. */
export async function ownedPages(
  db: Database,
  action: TargetAction,
  pages: readonly unknown[],
): Promise<string[]> {
  const ids = [...new Set(parseUuids(pages))];
  if (!ids.length) return [];
  const owned = await db
    .selectFrom('site_urls')
    .select('id')
    .where('workspace_id', '=', action.workspace_id)
    .where('project_id', '=', action.project_id)
    .where('id', 'in', ids)
    .execute();
  const allowed = new Set(owned.map((row) => row.id));
  return ids.filter((id) => allowed.has(id));
}

/** The page each finding's evidence names (`site_url_id`). */
export const evidencePages = (members: readonly DeclaredMember[]) =>
  members.map((member) => record(member.evidence).site_url_id);

/** Owned pages, at most `IMPLEMENTATION_TARGETS_MAX` of them. */
export function cappedPages(selected: string[]): DeclarationTargets {
  if (selected.length > o.IMPLEMENTATION_TARGETS_MAX)
    return { resolved: false, reason: 'Too many implementation targets' };
  return { resolved: true, target_site_url_ids: selected, target_external_url: null };
}

/**
 * A kind with no behaviour of its own (a product, category, prompt or query):
 * a declaration covers the owned pages its findings name, the read adds
 * nothing and the Agent is given only the row.
 */
export function plainTarget<K extends ActionTargetKind>(kind: K): ActionTargetModule<K> {
  return {
    kind,
    declarationTargets: async ({ db, action, members }) =>
      cappedPages(await ownedPages(db, action, evidencePages(members))),
    detail: async () => NO_DETAIL,
    agentContext: async () => ({}),
  };
}
