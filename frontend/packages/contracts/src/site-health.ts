/**
 * Stable Site Health schema facade.
 *
 * Keep all Site Health consumers importing this module (or `schemas.ts`). The
 * focused modules below keep the API contracts reviewable without changing the
 * inferred Zod schema identities or their public names.
 */
export * from './site-health/architecture.ts';
export * from './site-health/crawl.ts';
export * from './site-health/dashboard.ts';
export * from './site-health/internal-links.ts';
export * from './site-health/inventory.ts';
export * from './site-health/issues.ts';
export * from './site-health/pages.ts';
export * from './site-health/pagination.ts';
export * from './site-health/robots.ts';
