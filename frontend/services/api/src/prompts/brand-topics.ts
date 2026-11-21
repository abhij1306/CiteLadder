import type { ExpressionBuilder } from 'kysely';

import type { Database } from '../db/database.ts';
import type { DB } from '../generated/db-schema.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';

function targeted(eb: ExpressionBuilder<DB, 'topics' | 'prompts'>) {
  return eb.exists(
    eb
      .selectFrom('commerce_prompt_targets')
      .select('commerce_prompt_targets.id')
      .whereRef('commerce_prompt_targets.prompt_id', '=', 'prompts.id'),
  );
}

export function brandTopics(db: Database, { workspaceId, projectId }: ProjectScope) {
  return db
    .selectFrom('topics')
    .where('topics.workspace_id', '=', workspaceId)
    .where('topics.project_id', '=', projectId)
    .where((eb) => {
      const filed = () =>
        eb
          .selectFrom('prompts')
          .select('prompts.id')
          .whereRef('prompts.workspace_id', '=', 'topics.workspace_id')
          .whereRef('prompts.topic_id', '=', 'topics.id');
      return eb.or([
        eb.not(eb.exists(filed().where(targeted))),
        eb.exists(filed().where((inner) => inner.not(targeted(inner)))),
      ]);
    });
}
