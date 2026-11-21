import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { isGroupFolded, setGroupFolded } from './sidebar-folds';

afterEach(() => {
  vi.restoreAllMocks();
  setGroupFolded('website', false);
  setGroupFolded('tracking', false);
  window.localStorage.clear();
});

describe('sidebar group folds', () => {
  it('keeps each group fold in local storage, independently', () => {
    setGroupFolded('website', true);
    expect(isGroupFolded('website')).toBe(true);
    expect(isGroupFolded('tracking')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('citeladder:app:sidebar-folds') ?? '')).toEqual([
      'website',
    ]);
    setGroupFolded('website', false);
    expect(isGroupFolded('website')).toBe(false);
  });

  it('reads a fold another load wrote and ignores a corrupt value', () => {
    window.localStorage.setItem('citeladder:app:sidebar-folds', '["tracking"]');
    expect(isGroupFolded('tracking')).toBe(true);
    window.localStorage.setItem('citeladder:app:sidebar-folds', '{not json');
    expect(isGroupFolded('tracking')).toBe(false);
  });

  it('keeps a fold for the session when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setGroupFolded('tracking', true);
    expect(isGroupFolded('tracking')).toBe(true);
    expect(isGroupFolded('website')).toBe(false);
  });
});
