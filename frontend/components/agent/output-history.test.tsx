import { act, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { queryKeys } from '@/lib/api/query-keys';
import { CHAT, REV1, REV2, revision } from '@/test/agent-chat-fixture';

import { OutputHistory } from './output-history';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('OutputHistory', () => {
  it('refreshes history for a new latest revision and retains prefix invalidation', async () => {
    let items = [revision(REV1, 1, 'agent', 'First draft')];
    mswServer.use(
      http.get(`/api/v1/agent/chats/${CHAT}/output/revisions`, () => HttpResponse.json({ items })),
    );
    const { rerender, queryClient } = renderWithProviders(
      <OutputHistory
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        chatId={CHAT}
        latestRevisionId={REV1}
        canRestore={false}
      />,
    );
    expect(await screen.findByText('Revision 1')).toBeVisible();
    items = [...items, revision(REV2, 2, 'agent', 'Second draft')];
    rerender(
      <OutputHistory
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        chatId={CHAT}
        latestRevisionId={REV2}
        canRestore={false}
      />,
    );
    expect(await screen.findByText('Revision 2')).toBeVisible();
    items = [
      ...items,
      revision('44444444-4444-4444-8444-444444444443', 3, 'user', 'Restored draft'),
    ];
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.agent.revisions(CHAT) }));
    expect(await screen.findByText('Revision 3')).toBeVisible();
  });
});
