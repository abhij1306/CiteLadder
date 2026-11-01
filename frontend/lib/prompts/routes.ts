/** Query parameter that opens the Prompt Builder when the library loads. */
export const GENERATE_PROMPTS_PARAM = 'generate';
/** Query parameter that opens the Prompt Builder on its review step. */
export const REVIEW_PROMPTS_PARAM = 'review';

export const PROMPTS_HREF = '/prompts';
export const PROMPTS_GENERATE_HREF = `${PROMPTS_HREF}?${GENERATE_PROMPTS_PARAM}=1`;
