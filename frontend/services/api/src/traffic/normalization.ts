export function collapseIdentityWhitespace(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(' ');
}

export function normalizeQuery(value: string): string {
  return collapseIdentityWhitespace(value.normalize('NFKC').toLowerCase());
}
