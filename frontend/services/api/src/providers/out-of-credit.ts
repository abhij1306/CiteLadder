import { z } from 'zod';

import { policy } from '../config.ts';

const { statuses, markers } = policy.providers.out_of_credit;

const providerErrorBody = z.object({
  error: z.object({
    type: z.string().catch(''),
    code: z.string().nullish().catch(null),
    message: z.string().catch(''),
  }),
});

export const OUT_OF_CREDIT_CODE = policy.dataforseo.constants.error_account_unavailable;

export const mayBeOutOfCredit = (status: number) => statuses.includes(status);

export function isOutOfCredit(status: number, payload: unknown) {
  if (!mayBeOutOfCredit(status)) return false;
  const error = providerErrorBody.safeParse(payload).data?.error;
  if (!error) return false;
  const text = `${error.type} ${error.code ?? ''} ${error.message}`.toLowerCase();
  return markers.some((marker) => text.includes(marker));
}
