import config from './ai-traffic.json' with { type: 'json' };
import { z } from 'zod';
export const aiTraffic = z
  .object({
    formula_version: z.string().min(1),
    refresh_delay_seconds: z.number().nonnegative(),
    min_verified_requests: z.number().int().positive(),
    min_referral_sessions: z.number().int().positive(),
    concentration_top_k: z.number().int().positive(),
    concentration_share: z.number().gt(0).max(1),
    max_pattern_pages: z.number().int().positive(),
    max_timeline_items: z.number().int().positive(),
  })
  .parse(config);
