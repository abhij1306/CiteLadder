import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { PROJECT, skills } from '@/test/agent-chat-fixture';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { Composer } from './composer';
import { useSkillChoice } from './skill-picker';
import { useComposerCommands } from './use-composer-commands';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills))));
afterEach(() => {
  mswServer.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => mswServer.close());

function Host({ busy = false }: Readonly<{ busy?: boolean }>) {
  const [value, setValue] = useState('');
  const [skillId, setSkillId] = useState<string | null | undefined>(undefined);
  const commands = useComposerCommands({ workspaceId: 'workspace', projectId: PROJECT });
  const skill = useSkillChoice({ value: skillId, onChange: setSkillId });
  return (
    <Composer
      id="reply"
      label="Reply to the agent"
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      pending={false}
      disabled={false}
      submissionDisabled={busy}
      placeholder="Ask a follow-up"
      commands={commands}
      skill={skill}
    />
  );
}

describe('Composer', () => {
  it('lets Send be pressed only with a message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reply to the agent'), 'Shorten it.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('starts one line tall and grows with its text where the browser lacks field-sizing', async () => {
    vi.stubGlobal('CSS', { supports: () => false });
    // jsdom has no layout: the field's content height stands in for the browser's.
    const content = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(20);
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    const field = screen.getByLabelText('Reply to the agent');
    expect(field).toHaveAttribute('rows', '1');
    expect(field.style.height).toBe('20px');

    content.mockReturnValue(140);
    await user.type(field, 'One{Shift>}{Enter}{/Shift}Two');
    expect(field.style.height).toBe('140px');
    content.mockRestore();
  });

  it('leaves the height to the browser where it sizes the field itself', async () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'field-sizing' });
    const content = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(140);
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    const field = screen.getByLabelText('Reply to the agent');

    await user.type(field, 'One{Shift>}{Enter}{/Shift}Two');
    expect(field.style.height).toBe('');
    content.mockRestore();
  });

  it('keeps a / typed while a turn runs as text, and opens no menu when the turn ends', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<Host busy />);
    const field = screen.getByLabelText('Reply to the agent');

    await user.type(field, 'see /');
    expect(field).toHaveValue('see /');
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(<Host />);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.type(field, 'pricing');
    expect(field).toHaveValue('see /pricing');
  });
});
