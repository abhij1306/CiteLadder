import { describe, expect, it } from 'vite-plus/test';

import { nextStep } from './target-next-step';

const unmeasured = { snapshot: null, actions: [] };
const measured = {
  snapshot: {
    product_visibility: 0.5,
    share_of_shelf: null,
    average_shelf_position: null,
    first_position_win_rate: null,
    successful_execution_count: 2,
    recognized_slot_count: 1,
    ranked_execution_count: 0,
    measured_at: '2026-10-01T00:00:00Z',
  },
  actions: [],
};
const action = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Add the missing price',
  status: 'open' as const,
};

describe('nextStep', () => {
  it('walks a new target from competitors to a launch', () => {
    const step = (
      competitors: { state: 'pending' | 'approved' }[],
      prompts: { enabled: boolean }[],
    ) => nextStep({ kind: 'category', competitors, prompts, shelf: unmeasured });

    expect(step([], [])).toBe(
      'Find competitors for this category, so measurement can tell who holds the rest of the shelf.',
    );
    expect(step([{ state: 'pending' }, { state: 'pending' }], [])).toBe(
      'Review 2 competitor candidates.',
    );
    expect(step([{ state: 'approved' }], [])).toBe(
      'Generate buyer prompts to measure this category.',
    );
    expect(step([{ state: 'approved' }], [{ enabled: false }])).toBe(
      'Approve the buyer prompts that a real shopper would type.',
    );
    expect(step([{ state: 'approved' }], [{ enabled: true }])).toBe(
      'Review and launch an audit to measure this category.',
    );
  });

  it('sends a measured target to its Actions, or back to measuring after a change', () => {
    expect(
      nextStep({
        kind: 'product',
        competitors: [],
        prompts: [],
        shelf: { ...measured, actions: [action] },
      }),
    ).toBe(
      "1 Action can raise this product's visibility in AI answers. Start with the first one below.",
    );
    expect(nextStep({ kind: 'product', competitors: [], prompts: [], shelf: measured })).toBe(
      'No open Actions for this product. Launch the audit again after you change its pages to see the effect.',
    );
  });
});
