import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vite-plus/test';

import { ChatScreen } from '@/components/agent/chat-screen';
import { CHAT, PROJECT } from '@/test/agent-chat-fixture';
import { actionsPage } from '@/test/fixtures/actions';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

export function renderChat() {
  return renderWithProviders(
    <Routes>
      <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
    </Routes>,
    {
      initialEntries: [`/agent/chats/${CHAT}`],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

export function serveChatScreen(reset?: () => void) {
  beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() =>
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/actions`, () => HttpResponse.json(actionsPage())),
    ),
  );
  afterEach(() => {
    mswServer.resetHandlers();
    reset?.();
  });
  afterAll(() => mswServer.close());
}
