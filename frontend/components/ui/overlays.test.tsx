import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { Drawer } from './drawer';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from './dropdown';
import { Tooltip, TooltipProvider } from './tooltip';
import { ToastProvider, useToast } from './toast';

describe('Dialog', () => {
  it('is described by its description only when it has one', () => {
    const { rerender } = render(
      <Dialog open onOpenChange={() => {}} title="Launch audit" description="Pick engines">
        <p>Body content</p>
      </Dialog>,
    );
    expect(
      screen.getByRole('dialog', { name: 'Launch audit', description: 'Pick engines' }),
    ).toBeInTheDocument();

    rerender(
      <Dialog open onOpenChange={() => {}} title="Launch audit">
        <p>Body content</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Launch audit' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('restores focus to the control that opened it', async () => {
    const user = userEvent.setup();

    function DialogHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Launch audit
          </button>
          <Dialog open={open} onOpenChange={setOpen} title="Audit settings">
            <p>Choose audit settings</p>
          </Dialog>
        </>
      );
    }

    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Launch audit' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe('Drawer', () => {
  it('renders a labelled contextual sheet with a shared close action', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Evidence" description="Persisted sources">
        <p>Source details</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeInTheDocument();
    expect(screen.getByText('Persisted sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeInTheDocument();
  });

  it('closes from Escape or the scrim and restores focus to the opening control', async () => {
    const user = userEvent.setup();

    function DrawerHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            View evidence
          </button>
          <Drawer open={open} onOpenChange={setOpen} title="Evidence">
            <p>Source details</p>
          </Drawer>
        </>
      );
    }

    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: 'View evidence' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const overlay = document.querySelector<HTMLElement>('.drawer-overlay');
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('leaves default focus restoration intact when opened without a trigger', async () => {
    const user = userEvent.setup();

    function ProgrammaticDrawerHarness() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer open={open} onOpenChange={setOpen} title="Linked evidence">
          <p>Opened from URL state</p>
        </Drawer>
      );
    }

    render(<ProgrammaticDrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body).toHaveFocus();
  });
});

describe('Dropdown', () => {
  it('exposes a trigger with menu semantics (closed by default)', () => {
    render(
      <Dropdown>
        <DropdownTrigger>Menu</DropdownTrigger>
        <DropdownContent>
          <DropdownItem>Edit</DropdownItem>
        </DropdownContent>
      </Dropdown>,
    );
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Items are not mounted until opened.
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('marks the selected radio filter', () => {
    render(
      <Dropdown open>
        <DropdownTrigger>Range</DropdownTrigger>
        <DropdownContent>
          <DropdownRadioGroup value="month">
            <DropdownRadioItem value="week">Week</DropdownRadioItem>
            <DropdownRadioItem value="month">Month</DropdownRadioItem>
          </DropdownRadioGroup>
        </DropdownContent>
      </Dropdown>,
    );
    expect(screen.getByRole('menuitemradio', { name: 'Month' })).toHaveAttribute(
      'data-state',
      'checked',
    );
  });
});

describe('Tooltip', () => {
  it('renders its content when opened', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Coming soon" delayDuration={0}>
          <button type="button">Generate</button>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Generate' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Coming soon');
  });
});

describe('ToastProvider', () => {
  it('dismisses one of two notifications created in the same clock tick', async () => {
    const user = userEvent.setup();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1);

    function Harness() {
      const { notify } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            notify('First notification');
            notify('Second notification');
          }}
        >
          Notify twice
        </button>
      );
    }

    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Notify twice' }));
    expect(screen.getByText('First notification')).toBeInTheDocument();
    expect(screen.getByText('Second notification')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Notify twice' }));
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]!);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(1),
    );
    expect(screen.getByText('Second notification')).toBeInTheDocument();
    clock.mockRestore();
  });
});

describe('CopyButton', () => {
  it('serializes clipboard writes and keeps one success notification on repeated clicks', async () => {
    const user = userEvent.setup();
    let finishCopy!: () => void;
    const firstCopy = new Promise<void>((resolve) => {
      finishCopy = resolve;
    });
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
      .mockReturnValueOnce(firstCopy);
    render(
      <ToastProvider>
        <CopyButton value="Fix the heading hierarchy">Copy fix prompt</CopyButton>
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Copy fix prompt' });
    await user.click(button);
    await user.click(button);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Fix the heading hierarchy');

    await act(async () => finishCopy());
    await user.click(button);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Copy fix prompt' })).toBe(button);
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(1);
  });

  it('restarts the copied feedback timer without an earlier click clearing it', async () => {
    userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      render(<CopyButton value="Fix the heading hierarchy" iconOnly />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      });
      act(() => vi.advanceTimersByTime(1500));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
      });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1400));
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
