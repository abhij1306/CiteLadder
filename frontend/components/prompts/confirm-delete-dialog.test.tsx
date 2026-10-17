import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Prompt, Topic } from '@/lib/api/types';

import { ConfirmDeleteDialog, type PendingDelete } from './confirm-delete-dialog';

const topic = { id: 't1', name: 'Footwear', active_count: 3 } as Topic;
const prompt = { id: 'p1', text: 'best trail shoes' } as Prompt;

function renderDialog(pending: PendingDelete | null) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ConfirmDeleteDialog pending={pending} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

describe('ConfirmDeleteDialog', () => {
  it('shows nothing until a delete is pending', () => {
    renderDialog(null);

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deletes only after the confirm button is pressed', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog({ kind: 'prompt', prompt });
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels without deleting', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog({ kind: 'topic', topic });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('states what a topic delete does to its prompts before it happens', () => {
    renderDialog({ kind: 'topic', topic });

    expect(screen.getByRole('dialog').textContent).toMatch(/Footwear/);
    expect(screen.getByRole('dialog').textContent).toMatch(/3 active prompts/);
  });
});
