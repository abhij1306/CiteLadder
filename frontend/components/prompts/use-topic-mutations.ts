import { useMutation } from '@tanstack/react-query';

import { humanizeApiError } from '@/lib/api/errors';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { topicsMutations } from '@/lib/api/topics';
import type { Topic } from '@citeladder/contracts';

/**
 * The topic rail's writes: create (optionally under a parent), rename and
 * delete, with the one failure worth reporting. Each descriptor refreshes
 * the library on success.
 */
export function useTopicMutations({
  scope,
  onDeleted,
}: Readonly<{
  scope: ProjectScope;
  onDeleted: (topic: Topic) => void;
}>) {
  const create = useMutation(topicsMutations.create(scope));
  const rename = useMutation(topicsMutations.rename(scope));
  const removal = topicsMutations.remove(scope);
  const remove = useMutation({
    ...removal,
    onSuccess: async (data, topic, ...rest) => {
      onDeleted(topic);
      await removal.onSuccess?.(data, topic, ...rest);
    },
  });
  // Whichever topic mutation failed is the one worth reporting; they cannot
  // both be in flight from this panel.
  const failed = [create, remove, rename].find((mutation) => mutation.isError);
  const error = failed ? humanizeApiError(failed.error).message : null;
  return { create, rename, remove, error };
}
