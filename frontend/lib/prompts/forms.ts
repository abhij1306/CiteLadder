/**
 * Prompt manual-entry form model.
 *
 * A small zod schema + helpers used by the add/edit dialog. Kept separate from
 * the component so the mapping to the API payloads is unit-testable and the
 * dialog stays presentational. A new prompt needs only its text and topic;
 * editing also corrects its intent, buyer stage and persona tags. Theme and
 * cohort stay internal vocabulary with code defaults.
 */
import { z } from 'zod';

import type {
  PromptCreateRequest,
  PromptUpdateRequest,
} from '@citeladder/contracts/prompt-requests';
import { buyerStageSchema, promptIntentSchema } from '@citeladder/contracts/project';
import type { BuyerStage, Prompt, PromptFormLimits, PromptIntent } from '@citeladder/contracts';

/** The form's schema under the persona bound the API enforces (from the prompt-set list). */
export function promptFormSchema(limits: Pick<PromptFormLimits, 'persona_max_chars'>) {
  return z.object({
    text: z.string().trim().min(1, 'Prompt text is required.'),
    /** A topic id of the project, or '' for no topic. */
    topicId: z.string(),
    intent: promptIntentSchema,
    buyerStage: buyerStageSchema,
    /** The buyer the prompt is asked as; '' for none. */
    persona: z.string().trim().max(limits.persona_max_chars, 'Persona is too long.'),
  });
}

export type PromptFormValues = z.infer<ReturnType<typeof promptFormSchema>>;

/** Ordered intent options for the filter menu; '' renders as "Unspecified". */
export const intentValues: PromptIntent[] = promptIntentSchema.options;

export const intentLabels: Record<PromptIntent, string> = {
  '': 'Unspecified',
  discovery: 'Discovery',
  comparison: 'Comparison',
  purchase: 'Purchase',
  service: 'Service',
  local: 'Local',
};

/** Ordered buyer-stage options; '' renders as "Unspecified". */
export const buyerStageValues: BuyerStage[] = buyerStageSchema.options;

/** Buyer-journey stage, shown beside intent. */
export const buyerStageLabels: Record<BuyerStage, string> = {
  '': 'Unspecified',
  awareness: 'Awareness',
  consideration: 'Consideration',
  decision: 'Decision',
  implementation: 'Implementation',
};

/** A blank add form, filed under the topic the reader is looking at. */
export function emptyPromptForm(topicId: string | null = null): PromptFormValues {
  return { text: '', topicId: topicId ?? '', intent: '', buyerStage: '', persona: '' };
}

/** Prefill the form from an existing prompt (edit path). */
export function promptToFormValues(prompt: Prompt): PromptFormValues {
  return {
    text: prompt.text,
    topicId: prompt.topic_id ?? '',
    intent: prompt.intent,
    buyerStage: prompt.buyer_stage,
    persona: prompt.persona,
  };
}

/** Create payload: everything the form does not ask for takes its default. */
export function formValuesToPromptInput(values: PromptFormValues): PromptCreateRequest {
  const text = values.text.trim();
  return values.topicId ? { text, topic_id: values.topicId } : { text };
}

/**
 * Update payload: only the fields the form edits, so a generated prompt keeps
 * its theme, cohort and enabled state. An empty topic sends an explicit null,
 * which detaches the prompt from its topic.
 */
export function formValuesToPromptUpdate(values: PromptFormValues): PromptUpdateRequest {
  return {
    text: values.text.trim(),
    topic_id: values.topicId || null,
    intent: values.intent,
    buyer_stage: values.buyerStage,
    persona: values.persona.trim(),
  };
}
