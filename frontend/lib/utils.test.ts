import { describe, expect, it } from 'vite-plus/test';

import { cn } from './utils';

describe('cn', () => {
  it("lets a caller's named radius replace a primitive's, and keeps a size beside a colour", () => {
    expect(cn('bg-well rounded-mark', 'rounded-card')).toBe('bg-well rounded-card');
    expect(cn('rounded-mark', 'rounded-full')).toBe('rounded-full');
    expect(cn('text-body', 'text-negative')).toBe('text-body text-negative');
  });
});
