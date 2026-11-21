export const PRODUCT_WINDOW_DAYS = ['7', '30', '90'] as const;
export type ProductWindowDays = (typeof PRODUCT_WINDOW_DAYS)[number];
export const PRODUCT_DEFAULT_WINDOW: ProductWindowDays = '30';
