import { describe, expect, it } from 'vitest';
import { bodyChanges, mapSpan } from '../src/page-documents/anchors.ts';

describe('bodyChanges', () => {
  it('narrows a changed line to the characters that differ', () => {
    expect(bodyChanges('Intro\nOld line\nOutro', 'Intro\nNew line\nOutro')).toEqual([
      { from: 6, to: 9, inserted: 3 },
    ]);
  });

  it('counts a final line without a newline and blank lines in the offsets', () => {
    expect(bodyChanges('a\n\nb', 'a\n\nb\n')).toEqual([{ from: 4, to: 4, inserted: 1 }]);
    expect(bodyChanges('', 'a\n')).toEqual([{ from: 0, to: 0, inserted: 2 }]);
  });

  it('moves a span past an earlier change and drops one the change touches', () => {
    const changes = bodyChanges('One\nTwo\nThree\n', 'One more\nTwo\nThree\n');
    expect(mapSpan(changes, { start: 4, end: 7 })).toEqual({ start: 9, end: 12 });
    expect(mapSpan(changes, { start: 0, end: 4 })).toBeNull();
  });
});
