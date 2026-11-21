const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

export function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('//')) return '';
  try {
    const parsed = new URL(trimmed, 'https://local.invalid');
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return '';
  } catch {
    return '';
  }
  return trimmed;
}

export function linkHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

export function leavesForUnknownHost(
  href: string,
  knownHosts: readonly string[],
  appOrigin: string = globalThis.location?.origin ?? 'https://local.invalid',
): boolean {
  if (href === '') return false;
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return true;
  }
  if (url.protocol === 'mailto:') return true;
  if (url.origin === new URL(appOrigin).origin) return false;
  const host = linkHost(url.href);
  if (host === null) return true;
  return !knownHosts.some((known) => host === known || host.endsWith(`.${known}`));
}
