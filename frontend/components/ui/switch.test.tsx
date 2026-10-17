import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Switch } from './switch';

describe('Switch', () => {
  it('exposes role, accessible name and checked state', () => {
    const label = 'Use your own API keys.';
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} label={label} />,
    );

    const toggle = screen.getByRole('switch', { name: label });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    rerender(<Switch checked onCheckedChange={() => {}} label={label} />);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles on click', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Toggle" />);

    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  // A native <button> gives Space and Enter activation for free. These assert
  // that it really is a button — a div with a click handler would pass the
  // click test above and fail both of these.
  it('activates with Space', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Toggle" />);

    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('activates with Enter', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} label="Toggle" />);

    screen.getByRole('switch').focus();
    await userEvent.keyboard('{Enter}');
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('does not fire when disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Toggle" disabled />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('wires the description', () => {
    render(
      <>
        <Switch
          checked={false}
          onCheckedChange={() => {}}
          label="Toggle"
          describedBy="disclosure"
        />
        <p id="disclosure">You pay providers directly.</p>
      </>,
    );

    expect(screen.getByRole('switch')).toHaveAccessibleDescription('You pay providers directly.');
  });
});
