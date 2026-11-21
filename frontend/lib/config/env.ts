export function getLogoDevPublishable(): string | undefined {
  return process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE || undefined;
}
