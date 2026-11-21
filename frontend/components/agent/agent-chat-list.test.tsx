import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { isLiveTurnConnected, startLiveTurn } from '@/lib/agent/live-turns';
import { AGENT_CHAT_LIST_POLL_MS } from '@/lib/config/agent';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { ChatSection } from './agent-chat-list';

const PROJECT = '11111111-1111-4111-8111-111111111111';

const CHAT = {
  id: '33333333-3333-4333-8333-333333333331',
  project_id: PROJECT,
  action_id: null,
  origin: 'chat',
  target_label: null,
  title: 'Why did citations drop',
  turn_count: 1,
  output_kind: null,
  last_activity_at: '2026-11-12T10:00:00Z',
  created_at: '2026-11-12T10:00:00Z',
  running: false,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
const RUN = '55555555-5555-4555-8555-555555555551';

afterEach(() => {
  mswServer.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => mswServer.close());

describe('ChatSection', () => {
  it('says the chats failed to load and retries the list read', async () => {
    let up = false;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
        up
          ? HttpResponse.json({ items: [CHAT], next_cursor: null })
          : HttpResponse.json({ detail: 'refused' }, { status: 400 }),
      ),
    );
    renderWithProviders(<ChatSection />, {
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    });

    expect(await screen.findByText("Couldn't load chats.")).toBeVisible();
    up = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: /Why did citations drop/u })).toBeVisible();
    expect(screen.queryByText("Couldn't load chats.")).toBeNull();
  });

  it('skips the poll while this tab streams the running chat, then reads and polls once it closes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const reads: boolean[] = [];
    let streamed!: (close: () => void) => void;
    const streaming = new Promise<() => void>((resolve) => {
      streamed = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/agent/chats`, () => {
        reads.push(isLiveTurnConnected(RUN));
        return HttpResponse.json({ items: [{ ...CHAT, running: true }], next_cursor: null });
      }),
      http.post(`/api/v1/agent/chats/${CHAT.id}/runs/${RUN}/run`, () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            streamed(() => controller.close());
          },
        });
        return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    startLiveTurn(CHAT.id, RUN, null);
    const { queryClient } = renderWithProviders(<ChatSection />, {
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    });
    const landed = () =>
      new Promise<void>((resolve) => {
        const stop = queryClient.getQueryCache().subscribe((event) => {
          if (event.type !== 'updated' || event.action.type !== 'success') return;
          stop();
          resolve();
        });
      });
    await screen.findByRole('link', { name: /Why did citations drop/u });

    act(() => {
      vi.advanceTimersByTime(AGENT_CHAT_LIST_POLL_MS * 2);
    });
    const close = await streaming;
    const reread = landed();
    close();
    await reread;
    const polled = landed();
    act(() => {
      vi.advanceTimersByTime(AGENT_CHAT_LIST_POLL_MS);
    });
    await polled;

    expect(reads).toEqual([true, false, false]);
  });
});
