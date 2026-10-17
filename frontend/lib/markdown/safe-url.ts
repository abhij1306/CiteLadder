/**
 * URL sanitiser for untrusted (model-generated) Markdown links.
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
