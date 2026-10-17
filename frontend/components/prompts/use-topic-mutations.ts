import { useMutation } from '@tanstack/react-query';

import type { ApiRequestOptions } from '@/lib/api/client';
import { humanizeApiError } from '@/lib/api/errors';
import { topicsApi } from '@/lib/api/topics';
import type { Topic } from '@/lib/api/types';

/**
 * The topic rail's writes: create (optionally under a parent), rename and
 * delete, with the one failure worth reporting. Each success refreshes the
 * library through `invalidate`.
 */
export function useTopicMutations({
  projectId,
  requestOptions,
  invalidate,
  onDeleted,
}: Readonly<{
  projectId: string;
  requestOptions: () => ApiRequestOptions;
  invalidate: () => Promise<void>;
  onDeleted: (topic: Topic) => void;
}>) {
  const create = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) =>
      topicsApi.create(
        projectId,
        parentId ? { name, parent_id: parentId } : { name },
        requestOptions(),
      ),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: ({ topic, name }: { topic: Topic; name: string }) =>
      topicsApi.update(topic.id, { name }, requestOptions()),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (topic: Topic) => topicsApi.remove(topic.id, requestOptions()),
    onSuccess: async (_data, topic) => {
      onDeleted(topic);
      await invalidate();
    },
  });
  // Whichever topic mutation failed is the one worth reporting; they cannot
  // both be in flight from this panel.
  const failed = [create, remove, rename].find((mutation) => mutation.isError);
  const error = failed ? humanizeApiError(failed.error).message : null;
  return { create, rename, remove, error };
}
