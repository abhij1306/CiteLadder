import { describe, expect, it } from 'vite-plus/test';

import { diffLines } from './diff';

describe('diffLines', () => {
  it('marks removed and added lines around unchanged ones', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('declines a comparison beyond its bound instead of freezing the page', () => {
    const before = Array.from({ length: 3_000 }, (_, n) => `old ${n}`).join('\n');
    const after = Array.from({ length: 3_000 }, (_, n) => `new ${n}`).join('\n');

    expect(diffLines(before, after)).toBeNull();
  });
});
