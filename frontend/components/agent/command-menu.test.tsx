import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { CommandField } from './command-menu';

afterEach(() => vi.restoreAllMocks());

function MessageField({
  replacement,
  onEnter = vi.fn(),
}: {
  replacement: string;
  onEnter?: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="message">Message</label>
      <CommandField
        id="message"
        value={value}
        onChange={setValue}
        onEnter={onEnter}
        disabled={false}
        placeholder="Ask a question"
        maxRows={8}
        commands={{
          options: () => [{ key: 'pricing', label: 'Pricing page', replacement }],
          onPick: vi.fn(),
          mentions: [],
          onRemoveMention: vi.fn(),
        }}
      />
    </>
  );
}

it.each([false, true])(
  'keeps immediate typing in order after a mention (existing space: %s)',
  async (existingSpace) => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const user = userEvent.setup();
    const replacement = existingSpace ? '@Pricing' : '@Pricing page';
    renderWithProviders(<MessageField replacement={replacement} />);
    const field = screen.getByRole('combobox', { name: 'Message' });
    await user.type(field, existingSpace ? '@Pricing ' : '@Pricing');
    if (existingSpace) await user.keyboard('{ArrowLeft}');
    await user.click(screen.getByRole('option', { name: 'Pricing page' }));
    await user.keyboard('S');
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    await user.keyboard('horten it.');
    expect(field).toHaveValue(`${replacement} Shorten it.`);
  },
);

it('sends on Enter but not on the Enter that confirms an IME composition', () => {
  const onEnter = vi.fn();
  renderWithProviders(<MessageField replacement="@Pricing" onEnter={onEnter} />);
  const field = screen.getByRole('combobox', { name: 'Message' });
  fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
  expect(onEnter).toHaveBeenCalledTimes(0);
  fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
  expect(onEnter).toHaveBeenCalledTimes(1);
});
