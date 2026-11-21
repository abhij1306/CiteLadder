import { describe, expect, it } from 'vite-plus/test';

import { words } from './vocabulary';

describe('words', () => {
  it.each([
    ['ai_training', 'AI training'],
    ['ai_user_fetch', 'AI user fetch'],
    ['search_engine', 'Search engine'],
    ['maintain', 'Maintain'],
  ])('reads %s as %s', (token, expected) => {
    expect(words(token)).toBe(expected);
  });
});
