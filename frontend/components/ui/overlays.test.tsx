import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { Drawer } from './drawer';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from './menu';
import { focusByKeyboard } from '@/test/keyboard-focus';

import { InfoHint } from './info-hint';

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

  it('opens on a leading field with the caret only, never past a first choice', () => {
    const { rerender } = render(
      <Dialog open onOpenChange={() => {}} title="Invite member">
        <input aria-label="Email" />
        <input type="checkbox" aria-label="Admin" />
      </Dialog>,
    );
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect([email, email.hasAttribute('data-quiet-focus')]).toEqual([document.activeElement, true]);

    rerender(<Dialog open={false} onOpenChange={() => {}} title="Invite member" />);
    rerender(
      <Dialog open onOpenChange={() => {}} title="Invite member">
        <input type="checkbox" aria-label="Admin" />
        <input aria-label="Email" />
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
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

  it('returns focus to the menu trigger when a menu item opened it', async () => {
    const user = userEvent.setup();

    function MenuDialogHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Menu>
            <MenuTrigger>Manage project</MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setOpen(true)}>Edit project</MenuItem>
            </MenuContent>
          </Menu>
          <Dialog open={open} onOpenChange={setOpen} title="Edit project">
            <p>Project fields</p>
          </Dialog>
        </>
      );
    }

    render(<MenuDialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Manage project' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit project' }));
    expect(await screen.findByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Manage project' })).toHaveFocus();
  });
});

describe('Drawer', () => {
  it('renders a labelled contextual sheet with a shared close action', () => {
    render(
      <Drawer
        open
        onOpenChange={() => {}}
        title="Evidence"
        description="Persisted sources"
        footer={<button type="button">Save</button>}
      >
        <p>Source details</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeInTheDocument();
    expect(screen.getByText('Persisted sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' }).parentElement?.tagName).toBe('FOOTER');
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

describe('Menu', () => {
  it('exposes a trigger with menu semantics (closed by default)', () => {
    render(
      <Menu>
        <MenuTrigger>Menu</MenuTrigger>
        <MenuContent>
          <MenuItem>Edit</MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('marks the selected radio filter', () => {
    render(
      <Menu open>
        <MenuTrigger>Range</MenuTrigger>
        <MenuContent>
          <MenuRadioGroup value="month">
            <MenuRadioItem value="week">Week</MenuRadioItem>
            <MenuRadioItem value="month">Month</MenuRadioItem>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>,
    );
    expect(screen.getByRole('menuitemradio', { name: 'Month' })).toHaveAttribute(
      'data-state',
      'checked',
    );
  });

  it('reserves the check gutter on plain rows only in a menu with a checkable row', () => {
    const lead = (name: string) =>
      screen.getByRole('menuitem', { name }).querySelector('[data-menu-lead]');
    const { unmount } = render(
      <Menu open>
        <MenuTrigger>Range</MenuTrigger>
        <MenuContent>
          <MenuItem>Reset</MenuItem>
          <MenuRadioGroup value="month">
            <MenuRadioItem value="week">Week</MenuRadioItem>
            <MenuRadioItem value="month">Month</MenuRadioItem>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>,
    );
    expect(lead('Reset')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemradio', { name: 'Week' }).querySelector('[data-menu-lead]'),
    ).toBeInTheDocument();
    unmount();
    render(
      <Menu open>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuItem>Reset</MenuItem>
        </MenuContent>
      </Menu>,
    );
    expect(lead('Reset')).toBeNull();
  });

  it('runs the item reached with the arrow keys and closes', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onRename} shortcut="R">
            Rename
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={onDelete}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>,
    );
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toHaveTextContent('RenameR');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});

describe('Tooltip', () => {
  it('renders its content when the trigger takes keyboard focus', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Coming soon" shortcut="G">
          <button type="button">Generate</button>
        </Tooltip>
      </TooltipProvider>,
    );
    focusByKeyboard(screen.getByRole('button', { name: 'Generate' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Coming soonG');
  });
});

describe('InfoHint', () => {
  it('opens on a press or keyboard focus, never on hover, and closes on a second press or Esc', async () => {
    const user = userEvent.setup();
    render(
      <>
        <InfoHint label="About reach">Share of answers that cite you.</InfoHint>
        <button type="button">Elsewhere</button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'About reach' });
    expect(button).toHaveAccessibleDescription('Share of answers that cite you.');
    await user.hover(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.click(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Share of answers that cite you.');
    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    await user.click(button);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    focusByKeyboard(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Share of answers that cite you.');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });
});

describe('ToastProvider', () => {
  it('closes a plain notification after its time, leaving once its exit animation ends, but keeps one with an action', () => {
    vi.useFakeTimers();
    function Harness() {
      const { notify } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            notify('Prompt saved');
            notify('Prompt archived', undefined, { action: { label: 'Undo', onClick: vi.fn() } });
          }}
        >
          Notify
        </button>
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    act(() => vi.advanceTimersByTime(60_000));
    const saved = screen.getByText('Prompt saved').closest('li')!;
    expect(saved).toHaveAttribute('data-state', 'closed');
    fireEvent.animationEnd(saved);
    expect(screen.queryByText('Prompt saved')).not.toBeInTheDocument();
    expect(screen.getByText('Prompt archived')).toBeInTheDocument();
    vi.useRealTimers();
  });

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
    fireEvent.animationEnd(screen.getByText('First notification').closest('li')!);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(1),
    );
    expect(screen.getByText('Second notification')).toBeInTheDocument();
    clock.mockRestore();
  });

  it('shows at most three notifications, dropping the oldest, with the newest in front, and runs an action', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();

    function Harness() {
      const { notify } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            notify('Run queued');
            notify('Crawl started');
            notify('Prompt saved');
            notify('Prompt deleted', undefined, {
              tone: 'negative',
              action: { label: 'Undo', onClick: onUndo },
            });
          }}
        >
          Notify four times
        </button>
      );
    }

    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Notify four times' }));
    fireEvent.animationEnd(screen.getByText('Run queued').closest('li')!);
    expect(screen.queryByText('Run queued')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(3);
    const toast = (title: string) => screen.getByText(title).closest('li')!;
    const inFront = () =>
      ['Crawl started', 'Prompt saved', 'Prompt deleted'].filter((title) =>
        toast(title).hasAttribute('data-front'),
      );
    expect(inFront()).toEqual(['Prompt deleted']);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(inFront()).toEqual(['Prompt saved']);
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
