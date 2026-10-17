import { buyerTypeSchema, marketScopeSchema } from '@citeladder/contracts/project';
import type { z } from 'zod';

type BuyerType = z.infer<typeof buyerTypeSchema>;
type MarketScope = z.infer<typeof marketScopeSchema>;

/** Who buys: answered at onboarding and editable on the brand profile. */
export const BUYER_TYPE_CHOICES = [
  { value: 'b2c', label: 'Consumers' },
  { value: 'b2b', label: 'Businesses' },
  { value: 'both', label: 'Both' },
] as const satisfies readonly { value: BuyerType; label: string }[];

/** Where they buy. */
export const MARKET_SCOPE_CHOICES = [
  { value: 'local', label: 'Locally' },
  { value: 'national', label: 'Nationwide' },
  { value: 'regional', label: 'Regional' },
  { value: 'global', label: 'Worldwide' },
] as const satisfies readonly { value: MarketScope; label: string }[];

export type IdentityFacets = {
  category: string;
  buyer_type: BuyerType | null;
  market_scope: MarketScope | null;
};

/** Read the identity facets from a persisted business context; unknown values stay unset. */
export function identityFacets(context: Record<string, unknown>): IdentityFacets {
  const buyer = buyerTypeSchema.safeParse(context.buyer_type);
  const scope = marketScopeSchema.safeParse(context.market_scope);
  return {
    category: typeof context.category === 'string' ? context.category : '',
    buyer_type: buyer.success ? buyer.data : null,
    market_scope: scope.success ? scope.data : null,
  };
}
