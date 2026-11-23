import { useMutation } from '@tanstack/react-query';

import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { topicsMutations } from '@/lib/api/topics';
import type { Topic } from '@citeladder/contracts';

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
  const failed = [create, remove, rename].find((mutation) => mutation.isError);
  const error = failed ? mutationNoticeForError(failed.error, { action: 'save the topic' }) : null;
  return { create, rename, remove, error };
}
