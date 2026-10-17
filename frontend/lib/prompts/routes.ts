/** Query parameter that opens the Generate prompts dialog when the library loads. */
export const GENERATE_PROMPTS_PARAM = 'generate';
export const REVIEW_PROMPTS_PARAM = 'review';

export const PROMPTS_HREF = '/prompts';
export const PROMPTS_GENERATE_HREF = `${PROMPTS_HREF}?${GENERATE_PROMPTS_PARAM}=1`;
export const PROMPTS_REVIEW_HREF = `${PROMPTS_HREF}?${REVIEW_PROMPTS_PARAM}=1`;
