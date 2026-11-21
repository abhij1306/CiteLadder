import { z } from 'zod';

import { competitorRequestSchema } from './project-requests.ts';
import { brandDiscoverySchema } from './visibility.ts';

export const brandDiscoveryCreateRequestSchema = z.object({
  brand_name: z.string().trim().min(1).max(255),
  website_url: z.string().trim().min(1).max(1024),
  industry: z.string().trim().max(255).optional(),
  subindustry: z.string().trim().max(255).default(''),
  primary_market: z.string(),
  language_code: z.string().trim().max(16).default('en'),
});
export type BrandDiscoveryCreateRequest = z.input<typeof brandDiscoveryCreateRequestSchema>;

const confirmedDomains = () => z.array(z.string().trim().min(1)).min(1);

export const brandDiscoveryCompleteRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  profile: brandDiscoverySchema.shape.profile,
  domains: confirmedDomains(),
  competitors: z.array(competitorRequestSchema.extend({ domains: confirmedDomains() })).default([]),
});
export type BrandDiscoveryCompleteRequest = z.input<typeof brandDiscoveryCompleteRequestSchema>;
