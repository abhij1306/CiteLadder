import { logoDevUrl } from './logo-dev';

export function brandMarkSources({
  logoUrl,
  websiteUrl,
  pixels,
}: Readonly<{ logoUrl?: string | null; websiteUrl?: string | null; pixels: number }>): string[] {
  return [logoUrl || null, logoDevUrl(websiteUrl, pixels)].filter((src) => src !== null);
}
