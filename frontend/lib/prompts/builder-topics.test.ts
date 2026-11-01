import { describe, expect, it } from 'vite-plus/test';

import type { Topic } from '@/lib/api/types';

import { planProblem, topicPlan, topicRows, withProposals, type TopicRow } from './builder-topics';

const NETS = '11111111-1111-4111-8111-111111111111';
const MATS = '22222222-2222-4222-8222-222222222222';
const topic = (id: string, name: string): Topic => ({
  id,
  project_id: '33333333-3333-4333-8333-333333333333',
  parent_id: null,
  name,
  description: '',
  origin: 'manual',
  active_count: 0,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

describe('the topic plan', () => {
  it('turns edited rows into deletes, renames and creates, proposals keeping their offerings', () => {
    const rows = withProposals(topicRows([topic(NETS, 'Nets'), topic(MATS, 'Mats')]), [
      { name: 'Golf simulator enclosures', offerings: ['Simulator bay kit'] },
    ]);
    const edited: TopicRow[] = [
      ...rows.map((row): TopicRow => {
        if (row.kind !== 'existing') return row;
        return row.key === NETS ? { ...row, name: ' Golf nets ' } : { ...row, removed: true };
      }),
      { kind: 'added', key: 'new', name: 'Hitting mats' },
    ];
    expect(topicPlan(edited)).toEqual({
      delete: [MATS],
      rename: [{ id: NETS, name: 'Golf nets' }],
      create: [
        { name: 'Golf simulator enclosures', offerings: ['Simulator bay kit'] },
        { name: 'Hitting mats', offerings: [] },
      ],
    });
    expect(topicPlan(topicRows([topic(NETS, 'Nets')]))).toEqual({
      create: [],
      rename: [],
      delete: [],
    });
  });

  it('replaces earlier proposals with a new set and never drops an existing topic', () => {
    const first = withProposals(topicRows([topic(NETS, 'Nets')]), [
      { name: 'Old idea', offerings: ['Net'] },
    ]);
    const second = withProposals(first, [{ name: 'New idea', offerings: ['Net'] }]);
    expect(second.map((row) => [row.kind, row.name])).toEqual([
      ['existing', 'Nets'],
      ['proposed', 'New idea'],
    ]);
  });

  it('refuses a blank name or two topics sharing one, ignoring removed topics', () => {
    const rows = topicRows([topic(NETS, 'Nets'), topic(MATS, 'Mats')]);
    expect(planProblem(rows)).toBeNull();
    expect(planProblem([...rows, { kind: 'added', key: 'a', name: 'nets' }])).toBe(
      'Two topics share a name.',
    );
    expect(planProblem([...rows, { kind: 'added', key: 'a', name: '  ' }])).toBe(
      'Every topic needs a name.',
    );
    const removed = rows.map((row) =>
      row.kind === 'existing' && row.key === NETS ? { ...row, removed: true } : row,
    );
    expect(planProblem([...removed, { kind: 'added', key: 'a', name: 'Nets' }])).toBeNull();
  });
});
