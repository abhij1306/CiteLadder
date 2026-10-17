import { describe, expect, it } from 'vite-plus/test';

import type { Topic } from '@/lib/api/types';

import { orderTopicsForRail } from './topic-tree';

const topic = (id: string, name: string, parent_id: string | null = null): Topic => ({
  id,
  project_id: 'p',
  parent_id,
  name,
  description: '',
  origin: 'manual',
  active_count: 0,
  created_at: '',
  updated_at: '',
});

describe('orderTopicsForRail', () => {
  it('places subtopics under their parent and keeps orphans at top level', () => {
    const ordered = orderTopicsForRail([
      topic('b', 'Trail', 'a'),
      topic('a', 'Footwear'),
      topic('c', 'Orphan', 'missing'),
    ]);
    expect(ordered.map(({ label, nested }) => [label, nested])).toEqual([
      ['Footwear', false],
      ['Footwear › Trail', true],
      ['Orphan', false],
    ]);
  });
});
