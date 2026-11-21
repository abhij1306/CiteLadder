import { describe, expect, it } from 'vite-plus/test';

import {
  addWidget,
  addableWidgets,
  moveWidget,
  overviewRows,
  removeWidget,
  toggleWidth,
} from './layout';

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

  it('pairs half widgets into rows, a lone half alone in its row, pairing again after each full widget', () => {
    const keys = (widgets: Parameters<typeof overviewRows>[0]) =>
      overviewRows(widgets).map((row) => row.map((widget) => widget.key));
    expect(keys(layout)).toEqual([['project_state'], ['movement'], ['company_facts']]);
    expect(
      keys([
        { key: 'project_state', size: 'half' },
        { key: 'top_movers', size: 'half' },
        { key: 'movement', size: 'half' },
        { key: 'company_facts', size: 'full' },
        { key: 'next_action', size: 'half' },
        { key: 'ranked_actions', size: 'half' },
        { key: 'missing_prompts', size: 'half' },
      ]),
    ).toEqual([
      ['project_state', 'top_movers'],
      ['movement'],
      ['company_facts'],
      ['next_action', 'ranked_actions'],
      ['missing_prompts'],
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
      'next_action',
      'missing_prompts',
      'ranked_actions',
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
