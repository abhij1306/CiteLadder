import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ReorderList } from './reorder-list';

const ITEMS = ['Alpha', 'Beta', 'Gamma'].map((name) => ({ key: name, name, content: name }));

/** A drag's data store, shared by its start and its drop like the browser's. */
function dataTransfer(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
}

function row(name: string) {
  const element = screen.getByText(name).closest('li');
  if (!element) throw new Error(`${name} renders in a row`);
  return element;
}

function drag(from: string, to: string) {
  const transfer = dataTransfer();
  fireEvent.dragStart(row(from), { dataTransfer: transfer });
  fireEvent.drop(row(to), { dataTransfer: transfer });
}

describe('ReorderList', () => {
  it('moves a dragged row onto the row it is dropped on', () => {
    const moves: [number, number][] = [];
    render(<ReorderList items={ITEMS} pending={false} onMove={(...move) => moves.push(move)} />);

    drag('Alpha', 'Gamma');

    expect(moves).toEqual([[0, 2]]);
  });

  it('ignores text dropped from outside the list, numbers included', () => {
    const onMove = vi.fn<(from: number, to: number) => void>();
    render(<ReorderList items={ITEMS} pending={false} onMove={onMove} />);

    for (const text of ['https://example.com', '', '2', '1.5'])
      fireEvent.drop(row('Beta'), { dataTransfer: dataTransfer({ 'text/plain': text }) });
    drag('Beta', 'Gamma');

    expect(onMove.mock.calls).toEqual([[1, 2]]);
  });

  it('moves a row with its named move controls', () => {
    const moves: [number, number][] = [];
    render(<ReorderList items={ITEMS} pending={false} onMove={(...move) => moves.push(move)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Beta up' }));

    expect(moves).toEqual([[1, 0]]);
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled();
  });
});
