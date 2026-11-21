import { act, fireEvent, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { emitResize } from './resize-observer';

export async function expectThreadFollowsLatest({
  scope,
  user,
  newerReply,
}: Readonly<{
  scope: HTMLElement;
  user: UserEvent;
  newerReply: () => Promise<void>;
}>) {
  const thread = within(scope).getByRole('region', { name: 'Agent conversation' });
  expect(within(thread).queryByLabelText('Reply to the agent')).not.toBeInTheDocument();
  expect(within(scope).getByLabelText('Reply to the agent')).toBeInTheDocument();
  let height = 3000;
  Object.defineProperties(thread, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, value: 600 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });

  act(() => emitResize(thread));
  expect(thread.scrollTop).toBe(3000);

  thread.scrollTop = 1000;
  fireEvent.scroll(thread);
  await newerReply();
  height = 4000;
  act(() => emitResize(thread));
  expect(thread.scrollTop).toBe(1000);

  await user.click(within(scope).getByRole('button', { name: 'Jump to latest' }));
  expect(thread.scrollTop).toBe(4000);
  expect(within(scope).queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
}
