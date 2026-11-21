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
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(modality()).toBe('pointer');
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.keyboard('{Tab}');
    expect(modality()).toBe('keyboard');
  });

  it('rings only for focus a key moved: never for a key that moves none, a script focus or Escape', async () => {
    const user = userEvent.setup();
    render(<TwoButtons />);
    const theme = screen.getByRole('button', { name: 'Switch to light theme' });

    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.keyboard('{Shift}{PageDown}');
    expect(modality()).toBe('pointer');
    act(() => theme.focus());
    expect(modality()).toBe('pointer');
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      screen.getByRole('button', { name: 'Before' }).focus();
    });
    expect(modality()).toBe('pointer');

    await user.tab();
    expect([modality(), theme]).toEqual(['keyboard', document.activeElement]);
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

  it('quiets a field an overlay focused or a press entered; a Tab into it rings', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Page field" />
        <dialog open aria-label="Invite">
          <input aria-label="Email" />
          <button type="button">Send</button>
        </dialog>
        <div role="menu" aria-label="Page kind">
          <input aria-label="Search page kinds" />
        </div>
      </>,
    );
    const email = screen.getByRole('textbox', { name: 'Email' });
    const page = screen.getByRole('textbox', { name: 'Page field' });
    const quiet = (field: HTMLElement) => field.hasAttribute('data-quiet-focus');

    await user.keyboard('{Control>}k{/Control}');
    act(() => email.focus());
    expect(quiet(email)).toBe(true);

    await user.tab();
    await user.tab({ shift: true });
    expect([email, quiet(email)]).toEqual([document.activeElement, false]);
    await user.click(email);
    expect(quiet(email)).toBe(true);

    await user.click(page);
    expect([quiet(page), quiet(email)]).toEqual([false, false]);

    const search = screen.getByRole('textbox', { name: 'Search page kinds' });
    await user.click(search);
    expect(quiet(search)).toBe(true);
  });

  it('keeps the tooltip closed when the browser restores focus on returning to the tab', async () => {
    const user = userEvent.setup();
    render(<TwoButtons />);
    const theme = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

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

    await user.tab();
    await user.tab({ shift: true });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Switch to light theme');
  });
});
