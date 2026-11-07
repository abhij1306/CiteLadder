/**
 * Request bodies of a brand discovery: starting one from a website, and
 * completing a finished one into a project. These own the wire shape; the API
 * `.extend`s each with its configured markets, defaults and length and count
 * bounds, and the browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import { competitorRequestSchema } from './project-requests.ts';
import { brandDiscoverySchema } from './visibility.ts';

/** A discovery to start. An omitted industry takes the server's configured default. */
export const brandDiscoveryCreateRequestSchema = z.object({
  brand_name: z.string().trim().min(1).max(255),
  website_url: z.string().trim().min(1).max(1024),
  industry: z.string().trim().max(255).optional(),
  subindustry: z.string().trim().max(255).default(''),
  // GLOBAL or a country code the server supports.
  primary_market: z.string(),
  language_code: z.string().trim().max(16).default('en'),
});
export type BrandDiscoveryCreateRequest = z.input<typeof brandDiscoveryCreateRequestSchema>;

/** The confirmed domains: at least one each. */
const confirmedDomains = () => z.array(z.string().trim().min(1)).min(1);

/**
 * The reviewed discovery that becomes a project: its resolved business
 * context, the confirmed domains and the competitors to track.
 */
export const brandDiscoveryCompleteRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  profile: brandDiscoverySchema.shape.profile,
  domains: confirmedDomains(),
  competitors: z.array(competitorRequestSchema.extend({ domains: confirmedDomains() })).default([]),
});
export type BrandDiscoveryCompleteRequest = z.input<typeof brandDiscoveryCompleteRequestSchema>;
