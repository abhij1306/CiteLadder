import { act, fireEvent, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { emitResize } from './resize-observer';

/**
 * One reading session in a rendered chat (the page or the drawer), as the
 * reader sees it: the thread scrolls in its own region with the composer
 * outside it, follows the newest content while the reader is at the end,
 * leaves them where they are once they scroll up, and "Jump to latest"
 * brings them back. jsdom lays nothing out, so the region's size is stubbed
 * and growth is reported through `emitResize`.
 */
export async function expectThreadFollowsLatest({
  scope,
  user,
  newerReply,
}: Readonly<{
  /** The page or the drawer holding the chat. */
  scope: HTMLElement;
  user: UserEvent;
  /** Persists a newer reply and waits until it is drawn. */
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

  // A streamed reply grows the thread while the reader is at the end.
  act(() => emitResize(thread));
  expect(thread.scrollTop).toBe(3000);

  // The reader scrolls up; a newer reply no longer moves them.
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
