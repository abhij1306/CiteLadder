import type { useCommerceQueries } from '@/lib/products/use-products-screen';

/**
 * The Commerce read set, as one named type.
 *
 * It lives in its own module so the list, the detail sections, and the
 * workspace can all name it without importing each other — the panels file
 * used to be both the type owner and a component owner, which made every new
 * section a potential import cycle.
 */
export type CommerceQueries = ReturnType<typeof useCommerceQueries>;
