import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { MAX_GENERATION_COUNT } from '@/lib/config/prompts';
import {
  PromptProposalAction,
  promptPortfolioReport,
  proposedQuestionCount,
} from './prompt-proposal-action';

vi.mock('@/lib/prompts/use-prompt-set', () => ({
  usePromptSet: () => ({ ensurePromptSet: async () => ({ id: 'set' }) }),
}));
beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const row = (topic_id: string = crypto.randomUUID()) => ({
  topic_id,
  text: 'Which trail shoes grip wet rock?',
  buyer_stage: 'consideration',
  prompt_intent: 'recommend',
});
const portfolio = (rows: unknown[]) =>
  `Buyer questions\n\n\`\`\`JSON \n${JSON.stringify({ prompts: rows })}\n\`\`\``;

it('hides only a submittable proposal and keeps unsubmittable blocks visible for repair', () => {
  expect(promptPortfolioReport(portfolio([row(), row()]))).toBe('Buyer questions\n\n');
  for (const broken of [
    '```json\nnot valid JSON\n```',
    portfolio([]),
    portfolio([{ text: 'Missing its topic' }]),
    portfolio([row('not-a-uuid')]),
    portfolio(Array.from({ length: MAX_GENERATION_COUNT + 1 }, () => row())),
    portfolio([row()]) + '\n' + portfolio([row()]),
  ])
    expect(promptPortfolioReport(broken)).toBe(broken);
  expect(proposedQuestionCount(portfolio([row(), row()]))).toBe(2);
  expect(proposedQuestionCount(portfolio([{ text: 'Missing its topic' }]))).toBe(0);
});

it('submits only a saved revision on click and keeps an empty result recoverable', async () => {
  let submitted: unknown;
  mswServer.use(
    http.post('/api/v1/prompt-sets/set/generate', async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        candidates: [],
        topics: [],
        requested_count: 12,
        dropped_duplicates: 0,
        candidates_generated: 0,
        quality_gate: 'off',
        quality_rejected: 0,
        admission_drops: { off_topic: 2, unknown_topic: 1 },
      });
    }),
  );
  renderWithProviders(
    <PromptProposalAction
      workspaceId="workspace"
      revisionId="revision"
      body={portfolio(Array.from({ length: 12 }, () => row()))}
      disabled={false}
    />,
  );
  expect(submitted).toBeUndefined();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Review in Prompts' }));
  // The whole approved portfolio is eligible, not the default count.
  await waitFor(() => expect(submitted).toEqual({ agent_revision_id: 'revision', count: 12 }));
  expect((await screen.findByText(/No new questions passed admission/)).textContent).toMatch(
    /2 unrelated.*1 filed under a topic that no longer exists/,
  );
  expect(screen.getByRole('button', { name: 'Review in Prompts' })).toBeEnabled();
});
