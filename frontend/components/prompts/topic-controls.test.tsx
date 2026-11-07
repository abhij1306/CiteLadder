import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { Topic } from '@citeladder/contracts';

import { AddTopicDialog, ManageTopicsDialog, TopicFilter } from './topic-controls';

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    project_id: '11111111-1111-4111-8111-111111111111',
    name: 'Footwear',
    description: '',
    origin: 'manual',
    active_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Topic;
}

const parent = makeTopic({ active_count: 3 });
const child = makeTopic({
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Trail',
  parent_id: parent.id,
  active_count: 1,
});

function renderFilter(props: Partial<ComponentProps<typeof TopicFilter>> = {}) {
  return render(
    <TopicFilter
      topics={[child, parent]}
      selectedTopicId={null}
      onSelect={() => {}}
      onAdd={() => {}}
      onManage={() => {}}
      {...props}
    />,
  );
}

function renderManage(props: Partial<ComponentProps<typeof ManageTopicsDialog>> = {}) {
  return render(
    <TooltipProvider>
      <ManageTopicsDialog
        open
        onOpenChange={() => {}}
        topics={[parent, child]}
        onRename={async () => {}}
        onDelete={() => {}}
        onAdd={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

function renderAdd(props: Partial<ComponentProps<typeof AddTopicDialog>> = {}) {
  return render(
    <AddTopicDialog
      open
      onOpenChange={() => {}}
      topics={[parent, child]}
      onCreate={async () => {}}
      {...props}
    />,
  );
}

describe('TopicFilter', () => {
  it('lists every topic with its prompt count, a subtopic named with its parent, and filters by it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderFilter({ onSelect });

    const trigger = screen.getByRole('button', { name: 'Topic: All topics' });
    await user.click(trigger);
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'All topics',
      'Footwear (3)',
      'Footwear › Trail (1)',
    ]);
    await user.click(screen.getByRole('menuitemradio', { name: /^Footwear › Trail/ }));
    expect(onSelect).toHaveBeenCalledWith(child.id);
  });

  it('names the chosen topic and maps "All topics" back to no topic', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderFilter({ selectedTopicId: parent.id, onSelect });

    await user.click(screen.getByRole('button', { name: 'Topic: Footwear' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'All topics' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('ends with Add topic and Manage topics', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onManage = vi.fn();
    renderFilter({ onAdd, onManage });

    await user.click(screen.getByRole('button', { name: 'Topic: All topics' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add topic' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Topic: All topics' }));
    await user.click(screen.getByRole('menuitem', { name: 'Manage topics…' }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

describe('AddTopicDialog', () => {
  it('creates a subtopic under a chosen top-level topic, never under a subtopic', async () => {
    const user = userEvent.setup();
    const created: Array<[string, string | null]> = [];
    renderAdd({
      onCreate: async (name, parentId) => {
        created.push([name, parentId]);
      },
    });

    await user.type(screen.getByRole('textbox', { name: /Topic name/ }), 'Road');
    await user.click(screen.getByRole('combobox', { name: 'Add under' }));
    expect(screen.queryByRole('option', { name: 'Subtopic of Trail' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Subtopic of Footwear' }));
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(created).toEqual([['Road', parent.id]]);
  });

  it('keeps the typed name and shows the error when the create fails, and closes once it succeeds', async () => {
    const user = userEvent.setup();
    let fail = true;
    const onOpenChange = vi.fn();
    const view = renderAdd({
      onOpenChange,
      onCreate: async () => {
        if (fail) throw new Error('rejected');
      },
    });

    await user.type(screen.getByRole('textbox', { name: /Topic name/ }), 'Apparel');
    await user.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    view.rerender(
      <AddTopicDialog
        open
        onOpenChange={onOpenChange}
        topics={[parent, child]}
        onCreate={async () => {
          if (fail) throw new Error('rejected');
        }}
        error={{ message: 'Topic name already exists', retryable: false }}
      />,
    );
    expect(screen.getByText('Topic name already exists')).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Topic name/ })).toHaveValue('Apparel');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ManageTopicsDialog', () => {
  it('lists every topic with its count and deletes through the confirmation', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderManage({ onDelete });

    const list = within(screen.getByRole('list', { name: 'Topics' }));
    expect(list.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Footwear3',
      'Trail1',
    ]);
    await user.click(list.getByRole('button', { name: 'Delete topic Footwear › Trail' }));
    expect(onDelete).toHaveBeenCalledWith(child);
  });

  it('renames a topic in place, keeping the typed name when the save fails', async () => {
    const user = userEvent.setup();
    const renames: string[] = [];
    let fail = true;
    renderManage({
      onRename: async (_topic, name) => {
        renames.push(name);
        if (fail) throw new Error('rejected');
      },
    });
    const dialog = within(screen.getByRole('dialog', { name: 'Manage topics' }));

    await user.click(dialog.getByRole('button', { name: 'Rename topic Footwear' }));
    const field = dialog.getByRole('textbox', { name: 'New name for Footwear' });
    await user.clear(field);
    await user.type(field, 'Running shoes{Enter}');
    expect(dialog.getByRole('textbox', { name: 'New name for Footwear' })).toHaveValue(
      'Running shoes',
    );

    fail = false;
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(renames).toEqual(['Running shoes', 'Running shoes']);
    expect(dialog.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says when the topics could not be loaded', () => {
    renderManage({ topics: [], loadError: true });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load topics");
  });
});
