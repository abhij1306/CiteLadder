import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { Topic } from '@/lib/api/types';

import { TopicRail } from './topic-rail';

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

function renderRail(props: Partial<ComponentProps<typeof TopicRail>> = {}) {
  return render(
    <TooltipProvider>
      <TopicRail
        topics={[makeTopic()]}
        selectedTopicId={null}
        onSelect={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe('TopicRail', () => {
  it('names a subtopic with its parent so same-named subtopics stay distinct', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const parent = makeTopic();
    const child = makeTopic({
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Trail',
      parent_id: parent.id,
    });
    renderRail({ topics: [child, parent], onSelect });

    const nav = screen.getByRole('navigation', { name: 'Topics' });
    await user.click(within(nav).getByRole('button', { name: 'Footwear › Trail' }));
    expect(onSelect).toHaveBeenCalledWith(child.id);
    expect(
      within(nav).getByRole('button', { name: 'Delete topic Footwear › Trail' }),
    ).toBeInTheDocument();
  });

  it('renames a topic in place, keeping the typed name when the save fails', async () => {
    const user = userEvent.setup();
    const topic = makeTopic();
    const renames: string[] = [];
    let fail = true;
    const onRename = async (_topic: Topic, name: string) => {
      renames.push(name);
      if (fail) throw new Error('rejected');
    };
    renderRail({ topics: [topic], onRename });
    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));

    await user.click(nav.getByRole('button', { name: 'Rename topic Footwear' }));
    const field = nav.getByRole('textbox', { name: 'New name for Footwear' });
    await user.clear(field);
    await user.type(field, 'Running shoes{Enter}');
    expect(nav.getByRole('textbox', { name: 'New name for Footwear' })).toHaveValue(
      'Running shoes',
    );

    fail = false;
    await user.click(nav.getByRole('button', { name: 'Save' }));
    expect(renames).toEqual(['Running shoes', 'Running shoes']);
    expect(nav.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: 'Rename topic Footwear' }));
    await user.type(nav.getByRole('textbox', { name: 'New name for Footwear' }), '{Escape}');
    expect(nav.queryByRole('textbox')).not.toBeInTheDocument();
    expect(renames).toHaveLength(2);
  });

  it('preserves topic selection and create/delete actions', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    const onDelete = vi.fn();
    const topic = makeTopic({ active_count: 3 });

    const rail = renderRail({ topics: [topic], onSelect, onCreate, onDelete });
    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));

    await user.click(nav.getByRole('button', { name: /^Footwear/ }));
    expect(onSelect).toHaveBeenCalledWith(topic.id);

    await user.click(nav.getByRole('button', { name: 'Add topic' }));
    await user.type(nav.getByRole('textbox', { name: 'Topic name' }), 'Apparel');
    await user.click(nav.getByRole('button', { name: 'Add' }));
    expect(onCreate).toHaveBeenCalledWith('Apparel', null);

    await user.click(nav.getByRole('button', { name: 'Delete topic Footwear' }));
    expect(onDelete).toHaveBeenCalledWith(topic);

    rail.unmount();
  });

  it('creates a subtopic under a chosen top-level topic', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const parent = makeTopic();
    const child = makeTopic({
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Trail',
      parent_id: parent.id,
    });
    renderRail({ topics: [parent, child], onCreate });
    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));

    await user.click(nav.getByRole('button', { name: 'Add topic' }));
    await user.type(nav.getByRole('textbox', { name: 'Topic name' }), 'Road');
    await user.click(nav.getByRole('combobox', { name: 'Add under' }));
    // Subtopics nest one level deep: a subtopic is never offered as a parent.
    expect(screen.queryByRole('option', { name: 'Subtopic of Trail' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Subtopic of Footwear' }));
    await user.click(nav.getByRole('button', { name: 'Add' }));

    expect(onCreate).toHaveBeenCalledWith('Road', parent.id);
  });

  it('marks the selected topic with aria-current', () => {
    const topic = makeTopic();
    renderRail({ topics: [topic], selectedTopicId: topic.id });

    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));
    const selected = nav.getByRole('button', { name: /^Footwear/ });
    expect(selected).toHaveAttribute('aria-current', 'true');
  });
});

describe('TopicRail narrow selector', () => {
  it('renders a full-width Topics select for narrow viewports that filters by topic', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const topic = makeTopic({ name: 'Footwear' });

    renderRail({ topics: [topic], onSelect });

    // The narrow variant is the shared labelled Select, not part of the rail nav.
    const select = screen.getByRole('combobox', { name: 'Topics' });
    expect(select).toHaveTextContent('All topics');
    await user.click(select);
    expect(screen.getByRole('option', { name: 'All topics' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Footwear' }));
    expect(onSelect).toHaveBeenCalledWith(topic.id);
  });

  it('maps the "All topics" option back to a null selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const topic = makeTopic();

    renderRail({ topics: [topic], selectedTopicId: topic.id, onSelect });

    const select = screen.getByRole('combobox', { name: 'Topics' });
    expect(select).toHaveTextContent('Footwear');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'All topics' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('TopicRail error handling', () => {
  it('surfaces a load failure in both the rail and the narrow selector', () => {
    renderRail({ loadError: true });
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent("Couldn't load topics");
    }
    // One alert per responsive variant: inside the desktop rail <nav>, and
    // beside the narrow <select> (outside the nav).
    const rail = screen.getByRole('navigation', { name: 'Topics' });
    const [inRail, outsideRail] = [
      alerts.filter((a) => rail.contains(a)),
      alerts.filter((a) => !rail.contains(a)),
    ];
    expect(inRail).toHaveLength(1);
    expect(outsideRail).toHaveLength(1);
  });

  it('renders a create/delete action error', () => {
    renderRail({ actionError: 'Topic name already exists' });
    expect(screen.getAllByText('Topic name already exists').length).toBeGreaterThan(0);
  });

  it('keeps the add form open with the typed name when create fails', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));

    renderRail({ onCreate });
    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));

    await user.click(nav.getByRole('button', { name: 'Add topic' }));
    const field = nav.getByRole('textbox', { name: 'Topic name' });
    await user.type(field, 'Apparel');
    await user.click(nav.getByRole('button', { name: 'Add' }));

    expect(onCreate).toHaveBeenCalledWith('Apparel', null);
    // Form stays open with the value intact so the user can retry.
    expect(nav.getByRole('textbox', { name: 'Topic name' })).toHaveValue('Apparel');
  });

  it('clears the add form after a successful create', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    renderRail({ onCreate });
    const nav = within(screen.getByRole('navigation', { name: 'Topics' }));

    await user.click(nav.getByRole('button', { name: 'Add topic' }));
    await user.type(nav.getByRole('textbox', { name: 'Topic name' }), 'Apparel');
    await user.click(nav.getByRole('button', { name: 'Add' }));

    expect(onCreate).toHaveBeenCalledWith('Apparel', null);
    // Form collapses on success.
    expect(nav.queryByRole('textbox', { name: 'Topic name' })).not.toBeInTheDocument();
  });
});
