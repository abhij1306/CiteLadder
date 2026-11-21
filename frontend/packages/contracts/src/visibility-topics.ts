import { z } from 'zod';

import { winCountsSchema } from './visibility.ts';

const topicIdentity = {
  topic_id: z.uuid(),
  name: z.string(),
  renamed_from: z.array(z.string()),
};

const visibilityTopicRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_run'), ...topicIdentity }),
  z.object({
    kind: z.literal('measured'),
    ...topicIdentity,
    answers: z.number().int(),
    visibility_rate: z.number().nullable(),
    share_of_voice: z.number().nullable(),
    avg_position: z.number().nullable(),
    rank: z.number().int().nullable(),
    ranked_brands: z.number().int(),
    ...winCountsSchema.shape,
  }),
]);

export const visibilityTopicsSchema = z.object({
  source_audit_ids: z.array(z.uuid()),
  items: z.array(visibilityTopicRowSchema),
});

export type VisibilityTopicRow = z.infer<typeof visibilityTopicRowSchema>;
export type VisibilityTopics = z.infer<typeof visibilityTopicsSchema>;
