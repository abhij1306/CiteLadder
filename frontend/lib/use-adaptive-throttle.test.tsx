import { act, render, screen } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { useAdaptiveThrottle } from './use-adaptive-throttle';

afterEach(() => {
  vi.useRealTimers();
});

const PACE = { floor: 50, cap: 250 };
const COST: Record<string, number> = { slow: 80, slower: 200 };

const Painted = memo(function Painted({ text }: Readonly<{ text: string }>) {
  vi.setSystemTime(Number(vi.getMockedSystemTime()) + (COST[text] ?? 0));
  return <output>{text}</output>;
});

function Host({ value }: Readonly<{ value: string }>) {
  return <Painted text={useAdaptiveThrottle(value, PACE)} />;
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

it('waits twice the last repaint before the next one, within the floor and the cap', () => {
  vi.useFakeTimers();
  const { rerender } = render(<Host value="start" />);
  advance(100);

  rerender(<Host value="cheap" />);
  advance(0);
  expect(screen.getByRole('status')).toHaveTextContent('cheap');
  rerender(<Host value="slow" />);
  advance(49);
  expect(screen.getByRole('status')).toHaveTextContent('cheap');
  advance(1);

  rerender(<Host value="next" />);
  advance(79);
  expect(screen.getByRole('status')).toHaveTextContent('slow');
  advance(1);
  expect(screen.getByRole('status')).toHaveTextContent('next');

  rerender(<Host value="slower" />);
  advance(49);
  expect(screen.getByRole('status')).toHaveTextContent('next');
  advance(1);

  rerender(<Host value="last" />);
  advance(49);
  expect(screen.getByRole('status')).toHaveTextContent('slower');
  advance(1);
  expect(screen.getByRole('status')).toHaveTextContent('last');
});
