import { z } from 'zod';

export const brandMarkFields = {
  logo_url: z.string().nullable(),
  website_url: z.string().nullable(),
};
