import {
  promptBulkDeleteRequestSchema,
  promptBulkTopicRequestSchema,
} from '@citeladder/contracts/prompt-requests';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { isNonEmpty } from '../lists.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import { bindingError, bindingFailure, loadVocabulary } from './binding.ts';
import { acquireProjectLock } from './locks.ts';
import {
  deleteScopedPrompts,
  failures,
  refilePrompts,
  scopedPrompts,
  topicText,
} from './prompts.ts';

const P = policy.prompts;
const ids = promptBulkDeleteRequestSchema.shape.prompt_ids.max(P.bulk_prompts_max);

export const promptBulkDelete = promptBulkDeleteRequestSchema.extend({ prompt_ids: ids });
export const promptBulkTopic = promptBulkTopicRequestSchema.extend({ prompt_ids: ids });

export async function assignPromptTopic(
  db: Database,
  scope: ProjectScope,
  input: z.infer<typeof promptBulkTopic>,
): Promise<{ count: number }> {
  const promptIds = [...new Set(input.prompt_ids)];
  return inTransaction(db, async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const rows = await scopedPrompts(trx, scope, promptIds);
    const context = input.topic_id === null ? '' : await topicText(trx, scope, input.topic_id);
    const moved = rows.filter(
      (row) => row.status === P.status_active && row.topic_id !== input.topic_id,
    );
    if (isNonEmpty(moved)) {
      const vocabulary = await loadVocabulary(trx, scope);
      const failed = failures(moved, (row) => bindingFailure(row.text, vocabulary, context));
      if (isNonEmpty(failed))
        throw bindingError(
          failed[0].failure,
          `${failed.length} prompt(s) fail topical binding under this topic`,
          {
            prompts: failed.map(({ item, code, message }) => ({
              prompt_id: item.id,
              code,
              message,
            })),
          },
        );
    }
    await refilePrompts(trx, scope, { promptIds, topicId: input.topic_id });
    return { count: promptIds.length };
  });
}

export async function deletePrompts(
  db: Database,
  scope: ProjectScope,
  input: z.infer<typeof promptBulkDelete>,
): Promise<{ count: number }> {
  const promptIds = [...new Set(input.prompt_ids)];
  return inTransaction(db, async (trx) => {
    // Every prompt-set lock holder takes this lock first, so it excludes them all.
    await acquireProjectLock(trx, scope.projectId);
    await scopedPrompts(trx, scope, promptIds);
    // A single delete takes no lock, so one can win the race; the rest roll back.
    if ((await deleteScopedPrompts(trx, scope, promptIds)) !== promptIds.length)
      throw new ApiError(404, 'Prompt(s) not found in this project');
    return { count: promptIds.length };
  });
}
