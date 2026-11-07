/** Runs of whitespace as one space, trimmed. */
export function collapseIdentityWhitespace(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(' ');
}

/** A query's persisted identity: NFKC, lower case, collapsed whitespace. */
export function normalizeQuery(value: string): string {
  return collapseIdentityWhitespace(value.normalize('NFKC').toLowerCase());
}
