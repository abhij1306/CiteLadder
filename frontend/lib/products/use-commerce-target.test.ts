import { describe, expect, it } from 'vite-plus/test';

import { parseTargetKey, targetKey } from './use-commerce-target';

describe('target keys', () => {
  it('round-trips a target through its URL spelling', () => {
    const target = { kind: 'category' as const, id: '22222222-2222-4222-8222-222222222222' };
    expect(targetKey(target)).toBe('category:22222222-2222-4222-8222-222222222222');
    expect(parseTargetKey(targetKey(target))).toEqual(target);
  });

  it('rejects anything that is not a known kind with an id', () => {
    // A URL is user-editable, so a bad `?target=` must land on "nothing
    // selected" rather than on a request for a kind the API does not have.
    expect(parseTargetKey('shelf:22222222-2222-4222-8222-222222222222')).toBeUndefined();
    expect(parseTargetKey('category:')).toBeUndefined();
    expect(parseTargetKey('category')).toBeUndefined();
    expect(parseTargetKey('')).toBeUndefined();
    expect(parseTargetKey(null)).toBeUndefined();
    expect(parseTargetKey(undefined)).toBeUndefined();
  });
});
