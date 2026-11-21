import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ChecklistField } from './checklist-field';

describe('ChecklistField', () => {
  it('saves an edited row with its trimmed values and leaves edit mode', async () => {
    const saved = vi.fn();
    const editing = vi.fn();
    render(
      <ChecklistField
        label="Competitors"
        count="1 of 5"
        empty="None"
        items={[{ id: 'a', label: 'Acme', checked: true, editable: true }]}
        onToggle={vi.fn()}
        editingId="a"
        onEditingChange={editing}
        editor={{
          fields: [{ key: 'name', label: () => 'Competitor name', placeholder: 'Name' }],
          values: () => ({ name: 'Acme' }),
          onSave: saved,
          editLabel: (item) => `Edit ${item.label}`,
        }}
      />,
    );

    const user = userEvent.setup();
    const field = screen.getByRole('textbox', { name: 'Competitor name' });
    await user.clear(field);
    await user.type(field, '  Acme Corp  {Enter}');
    expect(saved).toHaveBeenCalledWith('a', { name: 'Acme Corp' });
    expect(editing).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('group', { name: 'Competitors' })).toHaveTextContent('1 of 5');
  });
});
