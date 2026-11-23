export function brandInitials(name: string) {
  const [first, second] = withoutBracketed(name).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!first) return '?';
  if (!second) return [...first].slice(0, 2).join('').toUpperCase();
  const [firstInitial = ''] = first;
  const [secondInitial = ''] = second;
  return (firstInitial + secondInitial).toUpperCase();
}

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
