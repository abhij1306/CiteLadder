import { describe, expect, it } from 'vite-plus/test';

import { applyOption, matchOptions, tokenAt } from './composer-commands';

describe('composer commands', () => {
  it('finds a command token only at a word start before the caret', () => {
    expect(tokenAt('/gro', 4)).toEqual({ trigger: '/', query: 'gro', start: 0, end: 4 });
    expect(tokenAt('Compare @pric', 13)).toEqual({
      trigger: '@',
      query: 'pric',
      start: 8,
      end: 13,
    });
    expect(tokenAt('see https://acme.example/pricing', 32)).toBeNull();
    expect(tokenAt('mail me@acme', 12)).toBeNull();
  });

  it('replaces the token and places the caret after the insertion', () => {
    const text = 'Compare @pric with last month';
    const token = tokenAt(text, 13)!;

    expect(
      applyOption(text, token, { key: 'a', label: 'Pricing', replacement: '@Pricing' }),
    ).toEqual({ text: 'Compare @Pricing with last month', caret: 17 });
    expect(
      applyOption('/gro', tokenAt('/gro', 4)!, { key: 's', label: 'Growth', replacement: '' }),
    ).toEqual({ text: '', caret: 0 });
  });

  it('matches every query word against label and detail', () => {
    const options = [
      { key: '1', label: 'Pricing page', detail: 'Page edits', replacement: '' },
      { key: '2', label: 'Blog hub', detail: 'Internal links', replacement: '' },
    ];

    expect(matchOptions(options, 'page edit').map((option) => option.key)).toEqual(['1']);
    expect(matchOptions(options, '').map((option) => option.key)).toEqual(['1', '2']);
  });
});
