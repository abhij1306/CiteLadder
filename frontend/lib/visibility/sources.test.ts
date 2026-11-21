import { describe, expect, it } from 'vite-plus/test';

import { SOURCE_SORT_CODEC } from './sources';

describe('SOURCE_SORT_CODEC', () => {
  it('reads a sort with the table it sorts and refuses an unknown column', () => {
    expect(SOURCE_SORT_CODEC.parse('domain:-responses')).toEqual({
      dimension: 'domain',
      sort: { column: 'responses', direction: 'desc' },
    });
    expect(SOURCE_SORT_CODEC.parse('url:key')).toEqual({
      dimension: 'url',
      sort: { column: 'key', direction: 'asc' },
    });
    expect(SOURCE_SORT_CODEC.parse('url:constructor')).toBeNull();
    expect(SOURCE_SORT_CODEC.parse('page:key')).toBeNull();
    expect(
      SOURCE_SORT_CODEC.serialize({
        dimension: 'url',
        sort: { column: 'mentions', direction: 'desc' },
      }),
    ).toBe('url:-mentions');
  });
});
