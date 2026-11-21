import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { SplitBar } from './split-bar';

const INTENTS = [
  { key: 'informational', label: 'Informational' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'transactional', label: 'Transactional' },
];

function Harness({ start }: Readonly<{ start: number[] }>) {
  const [values, setValues] = useState(start);
  return (
    <>
      <SplitBar label="Intent mix" segments={INTENTS} values={values} onChange={setValues} />
      <output aria-label="values">{values.join('/')}</output>
    </>
  );
}

const shown = () => screen.getByRole('status', { name: 'values' }).textContent;
const divider = (name: string) => screen.getByRole('slider', { name });

describe('SplitBar', () => {
  it('moves a divider by 5 per arrow key, between its limits, keeping the total', async () => {
    const user = userEvent.setup();
    render(<Harness start={[25, 50, 25]} />);
    const first = divider('Informational and Commercial');

    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(shown()).toBe('30/45/25');
    expect(first).toHaveAttribute('aria-valuenow', '30');
    expect(first).toHaveAttribute('aria-valuetext', 'Informational 30%, Commercial 45%');

    await user.keyboard('{End}');
    expect(shown()).toBe('75/0/25');
    await user.keyboard('{Home}{ArrowLeft}');
    expect(shown()).toBe('0/75/25');

    divider('Commercial and Transactional').focus();
    await user.keyboard('{ArrowDown}');
    expect(shown()).toBe('0/70/30');
  });

  it('snaps a press on the bar to 5% and moves the nearest divider there', () => {
    render(<Harness start={[25, 50, 25]} />);
    const bar = divider('Informational and Commercial').parentElement;
    if (!bar) throw new Error('The divider sits on the bar');
    bar.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, width: 200, height: 24 });

    fireEvent.pointerDown(bar, { clientX: 63, pointerId: 1 });
    expect(shown()).toBe('30/45/25');
    fireEvent.pointerMove(bar, { clientX: 171, pointerId: 1 });
    expect(shown()).toBe('75/0/25');
    fireEvent.pointerUp(bar, { pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 20, pointerId: 1 });
    expect(shown()).toBe('75/0/25');
  });
});
