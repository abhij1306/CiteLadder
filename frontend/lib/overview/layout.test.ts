import { describe, expect, it } from 'vite-plus/test';

import { addWidget, addableWidgets, moveWidget, removeWidget, toggleWidth } from './layout';

const layout = [
  { key: 'project_state', size: 'half' },
  { key: 'movement', size: 'full' },
  { key: 'company_facts', size: 'full' },
] as const;

describe('Overview layout edits', () => {
  it('moves a widget to a new position and ignores moves off either end', () => {
    expect(moveWidget(layout, 2, 0).map((widget) => widget.key)).toEqual([
      'company_facts',
      'project_state',
      'movement',
    ]);
    expect(moveWidget(layout, 0, -1)).toEqual(layout);
    expect(moveWidget(layout, 2, 3)).toEqual(layout);
  });

  it('switches only the chosen widget between half and full width', () => {
    expect(toggleWidth(layout, 0)).toEqual([
      { key: 'project_state', size: 'full' },
      { key: 'movement', size: 'full' },
      { key: 'company_facts', size: 'full' },
    ]);
  });

  it('removes a widget but keeps the last one', () => {
    expect(removeWidget(layout, 1).map((widget) => widget.key)).toEqual([
      'project_state',
      'company_facts',
    ]);
    expect(removeWidget([{ key: 'movement', size: 'half' }], 0)).toEqual([
      { key: 'movement', size: 'half' },
    ]);
  });

  it('offers only widgets not shown, and adds one at half width at the end', () => {
    expect(addableWidgets(layout)).toEqual([
      'citation_share',
      'next_action',
      'missing_prompts',
      'ranked_actions',
      'progress_proof',
      'visibility_trend',
      'share_of_voice',
      'top_movers',
      'retrieval',
      'perception',
      'ai_traffic',
      'search_console',
    ]);
    expect(addWidget(layout, 'perception').at(-1)).toEqual({ key: 'perception', size: 'half' });
    expect(addWidget(layout, 'movement')).toEqual(layout);
  });
});
