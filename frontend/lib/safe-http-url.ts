export function hasUnsafeUrlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 || character === '\\';
  });
}

export function parseAbsoluteHttpUrl(value: string | null | undefined): URL | null {
  if (!value || hasUnsafeUrlCharacters(value)) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
