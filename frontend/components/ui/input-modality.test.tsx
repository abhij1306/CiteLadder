import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { Tooltip } from './tooltip';

function TwoButtons() {
  return (
    <>
      <button type="button">Before</button>
      <Tooltip content="Switch to light theme" describe={false}>
        <button type="button" aria-label="Switch to light theme">
          Theme
        </button>
      </Tooltip>
    </>
  );
}

const modality = () => document.documentElement.dataset.inputModality;

describe('Focus that did not come from the keyboard', () => {
  it('marks the page by the last real input, ignoring shortcuts', async () => {
    const user = userEvent.setup();
    render(<TwoButtons />);

    await user.click(screen.getByRole('button', { name: 'Before' }));
    expect(modality()).toBe('pointer');
    // Ctrl+Tab switches browser tabs: not keyboard navigation of the page.
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(modality()).toBe('pointer');
    await user.keyboard('{Tab}');
    expect(modality()).toBe('keyboard');
  });

  it('opens a tooltip on a keyboard Tab, never on a script focus after a press', async () => {
    const user = userEvent.setup();
    render(<TwoButtons />);
    const theme = screen.getByRole('button', { name: 'Switch to light theme' });

    await user.click(screen.getByRole('button', { name: 'Before' }));
    act(() => theme.focus());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => theme.blur());
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(theme).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Switch to light theme');
  });

  it('keeps the tooltip closed when the browser restores focus on returning to the tab', async () => {
    const user = userEvent.setup();
    render(<TwoButtons />);
    const theme = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    // Leaving the tab blurs the window and the button; returning focuses the
    // button again with no key or press in between.
    act(() => {
      theme.blur();
      fireEvent.blur(window);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      fireEvent.focus(window);
      theme.focus();
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // The reader's next Tab is keyboard focus again.
    await user.tab();
    await user.tab({ shift: true });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Switch to light theme');
  });
});
