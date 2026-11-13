/**
 * URL sanitiser and off-site check for untrusted (model-generated) Markdown links.
 *
 * Split out of `markdown.tsx` so that file exports only its component — a
 * component module that also exports plain functions cannot keep state across a
 * Fast Refresh. The security contract is unchanged and still unit-tested.
 */
const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Allow only http/https/mailto; anything else (javascript:, data:, vbscript:,
 * protocol-relative tricks) collapses to an empty, inert URL. Relative URLs
 * are allowed (they resolve same-origin). */
export function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  // Reject protocol-relative URLs BEFORE resolving. `//evil.example/x` resolves
  // against the fallback origin to a `https:` URL, so the protocol check below
  // waves it through — and the value returned is the original `//evil.example/x`,
  // which the browser then resolves against the APP's origin and navigates
  // off-site. The check has to happen here because after resolution the hostile
  // and the benign case are indistinguishable.
  if (trimmed.startsWith('//')) return '';
  try {
    const parsed = new URL(trimmed, 'https://local.invalid');
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return '';
  } catch {
    return '';
  }
  return trimmed;
}

/**
 * The comparable host of a URL or bare domain (`https://www.Acme.com/x` and
 * `acme.com` both give `acme.com`); null when it names no host.
 */
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

/**
 * Whether opening a sanitised link should first confirm that the person is
 * leaving CiteLadder: a link to a host outside `knownHosts` (or a subdomain of
 * one) could carry project data a prompt-injected page asked the model to put
 * in its address. Links that stay on `appOrigin` (relative paths, fragments)
 * and inert links do not; `mailto:` always does, since its address can carry
 * data to anyone.
 *
 * The href is resolved the way the browser will resolve it, so a "relative"
 * value the browser reads as another host (`/\evil.example/x`) is judged by
 * that host.
 */
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
