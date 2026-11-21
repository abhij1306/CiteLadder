export function brandInitials(name: string) {
  const [first, second] = withoutBracketed(name).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!first) return '?';
  if (!second) return [...first].slice(0, 2).join('').toUpperCase();
  // Destructuring a string reads code points; a matched word is never empty.
  const [firstInitial = ''] = first;
  const [secondInitial = ''] = second;
  return (firstInitial + secondInitial).toUpperCase();
}

/**
 * Replaces each "(…)" span with a space: an opening bracket runs to the first
 * closing one after it, and an unclosed bracket is left as text. A linear scan
 * rather than a regex, which backtracks quadratically over unclosed brackets.
 */
function withoutBracketed(name: string): string {
  let result = '';
  let cursor = 0;
  for (let open = name.indexOf('('); open !== -1; open = name.indexOf('(', cursor)) {
    const close = name.indexOf(')', open + 1);
    if (close === -1) break;
    result += `${name.slice(cursor, open)} `;
    cursor = close + 1;
  }
  return result + name.slice(cursor);
}
