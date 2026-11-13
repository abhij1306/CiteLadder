/**
 * Commerce screen configuration (frontend config owner).
 *
 * The Products table's windows MIRROR the API's
 * `policy.commerce.products.window_days`, which refuses any other window
 * (422): the table offers only what the read accepts. No previous-period
 * deltas (CM8).
 */
export const PRODUCT_WINDOW_DAYS = ['7', '30', '90'] as const;
export type ProductWindowDays = (typeof PRODUCT_WINDOW_DAYS)[number];
export const PRODUCT_DEFAULT_WINDOW: ProductWindowDays = '30';
