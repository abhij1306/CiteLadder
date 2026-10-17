/**
 * Centralized access to public runtime configuration.
 *
 * Access is intentionally lazy: tests and Next.js environments can provide or
 * change public variables without importing this module at build time.
 */
export function getLogoDevPublishable(): string | undefined {
  return process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE || undefined;
}
